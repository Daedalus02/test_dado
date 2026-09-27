'use client';

import { useEffect, useRef } from 'react';
import { getConsent, onConsentChange } from '@/lib/consent-client';
import type { VideoSource } from '@/config';
import type { PlayerEvent, PlayerEventType } from '@/lib/progress';

interface Props {
  videoId: string;
  source: VideoSource;
  /** id della riga `hits` registrata dal server component */
  hitId: number | null;
  /** se omesso viene letto/creato in sessionStorage (stesso id dopo un reload) */
  sessionId?: string;
  /** true se va atteso il consenso prima di tracciare */
  requireConsent: boolean;
}

interface Snapshot {
  sessionId: string;
  videoId: string;
  hitId: number | null;
  duration: number | null;
  currentTime: number;
  maxTime: number;
  watchedDelta: number;
  completed: boolean;
  events: PlayerEvent[];
  final: boolean;
}

const INIT_URL = '/api/progress/init';
const TICK_URL = '/api/progress/tick';
const TICK_MS = 10_000;
/** Oltre questo salto tra due timeupdate si assume un seek, non visione. */
const MAX_WATCH_DELTA_S = 2;
const COMPLETION_RATIO = 0.95;
const MAX_BUFFERED_EVENTS = 200;
/** Limite di body per le richieste keepalive (quota browser: 64KB). */
const KEEPALIVE_MAX_BYTES = 60_000;
const TRACKED_EVENTS: PlayerEventType[] = ['play', 'pause', 'seeking', 'seeked', 'ended'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID v4 casuale: non derivato da alcun dato personale. */
function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // crypto.randomUUID richiede un contesto sicuro (https / localhost)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getOrCreateSessionId(videoId: string): string {
  const key = `vt-session:${videoId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && UUID_RE.test(existing)) return existing;
  } catch {
    // sessionStorage non disponibile: sessione valida solo per questa pagina
  }
  const id = randomUuid();
  try {
    sessionStorage.setItem(key, id);
  } catch {}
  return id;
}

const supportsKeepalive = typeof Request !== 'undefined' && 'keepalive' in Request.prototype;

function post(url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: supportsKeepalive && body.length <= KEEPALIVE_MAX_BYTES,
  });
}

/** Invio "fire and forget" in chiusura pagina: fetch keepalive, altrimenti sendBeacon. */
function sendFinal(url: string, body: string): void {
  const beacon = () => navigator.sendBeacon?.(url, body);
  if (supportsKeepalive && body.length <= KEEPALIVE_MAX_BYTES) {
    try {
      post(url, body).catch(beacon);
      return;
    } catch {
      // fallthrough su sendBeacon
    }
  }
  beacon();
}

interface TrackerOptions {
  sessionId: string;
  videoId: string;
  hitId: number | null;
  requireConsent: boolean;
  /** durata in secondi, null finché non è nota */
  getDuration(): number | null;
  getCurrentTime(): number;
}

interface Tracker {
  /** POST init (idempotente): parte appena ci sono durata e consenso */
  init(): void;
  /** nuova posizione del player; `counting` = in riproduzione e non in seek */
  time(t: number, counting: boolean): void;
  event(type: PlayerEventType, t: number): void;
  /** flush finale e rimozione dei listener */
  dispose(): void;
}

/**
 * Tracking indipendente dal player: stato in memoria, init -> tick (delta) -> flush di chiusura,
 * consenso. I player (HTML5, YouTube) gli passano solo posizione ed eventi.
 */
function startTracking({
  sessionId,
  videoId,
  hitId,
  requireConsent,
  getDuration,
  getCurrentTime,
}: TrackerOptions): Tracker {
  let enabled = !requireConsent || getConsent() === 'accepted';
  let inited = false;
  let inFlight = false;

  // Stato in memoria: si inviano solo i delta (secondi guardati, nuovi eventi).
  const s = {
    lastTime: getCurrentTime(),
    maxTime: 0,
    sentMaxTime: -1,
    watchedDelta: 0,
    completed: false,
    events: [] as PlayerEvent[],
  };

  const dirty = () => s.watchedDelta > 0 || s.events.length > 0 || s.maxTime !== s.sentMaxTime;

  /** Estrae uno snapshot e azzera i delta; `restore` li reintegra se l'invio fallisce. */
  const take = (final: boolean): Snapshot => {
    const snap: Snapshot = {
      sessionId,
      videoId,
      hitId,
      duration: getDuration(),
      currentTime: getCurrentTime(),
      maxTime: s.maxTime,
      watchedDelta: s.watchedDelta,
      completed: s.completed,
      events: s.events,
      final,
    };
    s.watchedDelta = 0;
    s.events = [];
    s.sentMaxTime = s.maxTime;
    return snap;
  };
  const restore = (snap: Snapshot) => {
    s.watchedDelta += snap.watchedDelta;
    s.events = [...snap.events, ...s.events].slice(-MAX_BUFFERED_EVENTS);
    s.sentMaxTime = -1;
  };

  const init = () => {
    const d = getDuration();
    if (!enabled || inited || d === null) return;
    inited = true;
    post(INIT_URL, JSON.stringify({ sessionId, videoId, hitId, duration: d })).catch(() => {
      inited = false;
    });
  };

  const tick = async () => {
    if (!enabled || inFlight || !dirty()) return;
    const snap = take(false);
    inFlight = true;
    try {
      const res = await post(TICK_URL, JSON.stringify(snap));
      if (!res.ok) restore(snap); // 429 incluso: si riprova al tick successivo
    } catch {
      restore(snap);
    } finally {
      inFlight = false;
    }
  };

  const flush = () => {
    if (!enabled || !dirty()) return;
    sendFinal(TICK_URL, JSON.stringify(take(true)));
  };

  const time = (t: number, counting: boolean) => {
    if (!enabled) return;
    const delta = t - s.lastTime;
    if (counting && delta > 0 && delta < MAX_WATCH_DELTA_S) {
      s.watchedDelta += delta;
    }
    s.lastTime = t;
    if (t > s.maxTime) s.maxTime = t;
    const d = getDuration();
    if (d !== null && s.maxTime >= COMPLETION_RATIO * d) s.completed = true;
  };

  const event = (type: PlayerEventType, t: number) => {
    if (!enabled) return;
    s.events.push({ type, time: Math.round(t * 100) / 100, at: Date.now() });
    if (s.events.length > MAX_BUFFERED_EVENTS) s.events.shift();
    if (type === 'ended') s.completed = true;
    if (type === 'seeked' || type === 'play') s.lastTime = t;
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };

  const unsubscribeConsent = onConsentChange((value) => {
    enabled = !requireConsent || value === 'accepted';
    if (enabled) {
      s.lastTime = getCurrentTime();
      init();
    }
  });

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('beforeunload', flush);
  const interval = window.setInterval(tick, TICK_MS);

  return {
    init,
    time,
    event,
    dispose() {
      flush();
      window.clearInterval(interval);
      unsubscribeConsent();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', flush);
    },
  };
}

// ---- YouTube IFrame Player API (tipi minimi, senza dipendenze) ----

interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { target: YTPlayer; data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_API_SRC = 'https://www.youtube.com/iframe_api';
/** Campionamento della posizione durante la riproduzione. */
const YT_POLL_MS = 500;
/** YouTube può riportare la posizione qualche ms indietro (es. su ENDED): non è un seek. */
const YT_SEEK_BACK_TOLERANCE_S = 0.5;
let ytApi: Promise<YTNamespace> | null = null;

/** Carica lo script dell'API una sola volta (anche tra più player e remount). */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytApi) {
    ytApi = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT!);
      };
      if (!document.querySelector(`script[src="${YT_API_SRC}"]`)) {
        const script = document.createElement('script');
        script.src = YT_API_SRC;
        script.async = true;
        script.onerror = () => {
          script.remove();
          ytApi = null;
          reject(new Error('YouTube IFrame API non caricata'));
        };
        document.head.appendChild(script);
      }
    });
  }
  return ytApi;
}

// ---- componente ----

export function TrackedVideo({ videoId, source, hitId, sessionId: sessionIdProp, requireConsent }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<HTMLDivElement>(null);
  const sourceType = source.type;
  const sourceKey = source.type === 'html5' ? source.src : source.youtubeId;
  const fallbackDuration = source.type === 'youtube' ? source.duration : null;

  // HTML5: gli eventi nativi del <video> alimentano il tracker.
  useEffect(() => {
    if (sourceType !== 'html5') return;
    const video = videoRef.current;
    if (!video) return;

    const tracker = startTracking({
      sessionId: sessionIdProp ?? getOrCreateSessionId(videoId),
      videoId,
      hitId,
      requireConsent,
      getDuration: () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null),
      getCurrentTime: () => video.currentTime,
    });

    const onTimeUpdate = () => tracker.time(video.currentTime, !video.paused && !video.seeking);
    const onPlayerEvent = (e: Event) => tracker.event(e.type as PlayerEventType, video.currentTime);

    video.addEventListener('loadedmetadata', tracker.init);
    video.addEventListener('timeupdate', onTimeUpdate);
    for (const type of TRACKED_EVENTS) video.addEventListener(type, onPlayerEvent);

    // Metadata già caricati prima che l'effetto si agganciasse (cache).
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) tracker.init();

    return () => {
      tracker.dispose();
      video.removeEventListener('loadedmetadata', tracker.init);
      video.removeEventListener('timeupdate', onTimeUpdate);
      for (const type of TRACKED_EVENTS) video.removeEventListener(type, onPlayerEvent);
    };
  }, [sourceType, sourceKey, videoId, hitId, sessionIdProp, requireConsent]);

  // YouTube: niente timeupdate/seek nativi, si campiona getCurrentTime() durante la riproduzione.
  useEffect(() => {
    if (sourceType !== 'youtube') return;
    const container = ytRef.current;
    if (!container) return;

    const sessionId = sessionIdProp ?? getOrCreateSessionId(videoId);
    let player: YTPlayer | null = null;
    let duration: number | null = null;
    let poll: number | undefined;
    let lastPos = 0;
    let ready = false;
    let disposed = false;

    // I metodi del player esistono solo dopo onReady.
    const currentTime = () => (ready && player ? player.getCurrentTime() : 0);
    const tracker = startTracking({
      sessionId,
      videoId,
      hitId,
      requireConsent,
      getDuration: () => duration,
      getCurrentTime: currentTime,
    });

    /** Un salto all'indietro o di almeno 2s tra due campioni è un seek, non visione. */
    const detectSeek = (t: number) => {
      const delta = t - lastPos;
      if (delta < -YT_SEEK_BACK_TOLERANCE_S || delta >= MAX_WATCH_DELTA_S) {
        tracker.event('seeking', lastPos);
        tracker.event('seeked', t);
      }
      lastPos = t;
    };
    const sample = (counting: boolean) => {
      const t = currentTime();
      detectSeek(t);
      tracker.time(t, counting);
    };
    const stopPoll = () => {
      window.clearInterval(poll);
      poll = undefined;
    };

    loadYouTubeApi()
      .then((YT) => {
        if (disposed) return;
        // Il player sostituisce l'elemento con un iframe: lo creiamo fuori dal controllo di React.
        const el = document.createElement('div');
        el.id = `yt-player-${sessionId}`;
        container.appendChild(el);
        player = new YT.Player(el, {
          videoId: sourceKey,
          width: '100%',
          height: '100%',
          playerVars: {
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
            controls: 1,
          },
          events: {
            onReady: (e) => {
              ready = true;
              const d = e.target.getDuration();
              duration = d > 0 ? d : fallbackDuration;
              lastPos = e.target.getCurrentTime();
              tracker.init();
            },
            onStateChange: (e) => {
              switch (e.data) {
                case YT.PlayerState.PLAYING: {
                  const d = e.target.getDuration();
                  // prima del caricamento YouTube riporta la durata arrotondata: tieni quella precisa
                  if (d > 0 && (duration === null || !Number.isInteger(d))) duration = d;
                  tracker.init();
                  const t = e.target.getCurrentTime();
                  detectSeek(t); // seek fatto a video fermo
                  tracker.event('play', t);
                  if (poll === undefined) {
                    poll = window.setInterval(
                      () => sample(e.target.getPlayerState() === YT.PlayerState.PLAYING),
                      YT_POLL_MS,
                    );
                  }
                  break;
                }
                case YT.PlayerState.PAUSED:
                  stopPoll();
                  sample(true);
                  tracker.event('pause', lastPos);
                  break;
                case YT.PlayerState.ENDED:
                  stopPoll();
                  sample(true);
                  tracker.event('ended', lastPos);
                  break;
                // BUFFERING, CUED, UNSTARTED: ignorati
              }
            },
          },
        });
      })
      .catch(() => {
        // API non raggiungibile (rete, adblock): niente player né tracking del progresso
      });

    return () => {
      disposed = true;
      stopPoll();
      tracker.dispose(); // prima di destroy: il flush legge ancora la posizione
      player?.destroy();
      player = null;
      ready = false;
      container.replaceChildren();
    };
  }, [sourceType, sourceKey, fallbackDuration, videoId, hitId, sessionIdProp, requireConsent]);

  if (source.type === 'youtube') return <div ref={ytRef} className="player yt-player" />;
  return <video ref={videoRef} className="player" src={source.src} controls playsInline preload="metadata" />;
}
