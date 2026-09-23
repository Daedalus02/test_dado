'use client';

import { useEffect, useRef } from 'react';
import { getConsent, onConsentChange } from '@/lib/consent-client';
import type { PlayerEvent, PlayerEventType } from '@/lib/progress';

interface Props {
  videoId: string;
  src: string;
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

export function TrackedVideo({ videoId, src, hitId, sessionId: sessionIdProp, requireConsent }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const sessionId = sessionIdProp ?? getOrCreateSessionId(videoId);
    let enabled = !requireConsent || getConsent() === 'accepted';
    let inited = false;
    let inFlight = false;

    // Stato in memoria: si inviano solo i delta (secondi guardati, nuovi eventi).
    const s = {
      lastTime: video.currentTime,
      maxTime: 0,
      sentMaxTime: -1,
      watchedDelta: 0,
      completed: false,
      events: [] as PlayerEvent[],
    };

    const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    const dirty = () => s.watchedDelta > 0 || s.events.length > 0 || s.maxTime !== s.sentMaxTime;

    /** Estrae uno snapshot e azzera i delta; `restore` li reintegra se l'invio fallisce. */
    const take = (final: boolean): Snapshot => {
      const snap: Snapshot = {
        sessionId,
        videoId,
        hitId,
        duration: duration(),
        currentTime: video.currentTime,
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
      const d = duration();
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

    const onTimeUpdate = () => {
      if (!enabled) return;
      const t = video.currentTime;
      const delta = t - s.lastTime;
      if (!video.paused && !video.seeking && delta > 0 && delta < MAX_WATCH_DELTA_S) {
        s.watchedDelta += delta;
      }
      s.lastTime = t;
      if (t > s.maxTime) s.maxTime = t;
      const d = duration();
      if (d !== null && s.maxTime >= COMPLETION_RATIO * d) s.completed = true;
    };

    const onPlayerEvent = (e: Event) => {
      if (!enabled) return;
      const type = e.type as PlayerEventType;
      s.events.push({ type, time: Math.round(video.currentTime * 100) / 100, at: Date.now() });
      if (s.events.length > MAX_BUFFERED_EVENTS) s.events.shift();
      if (type === 'ended') s.completed = true;
      if (type === 'seeked' || type === 'play') s.lastTime = video.currentTime;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    const unsubscribeConsent = onConsentChange((value) => {
      enabled = !requireConsent || value === 'accepted';
      if (enabled) {
        s.lastTime = video.currentTime;
        init();
      }
    });

    video.addEventListener('loadedmetadata', init);
    video.addEventListener('timeupdate', onTimeUpdate);
    for (const type of TRACKED_EVENTS) video.addEventListener(type, onPlayerEvent);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', flush);
    const interval = window.setInterval(tick, TICK_MS);

    // Metadata già caricati prima che l'effetto si agganciasse (cache).
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) init();

    return () => {
      flush();
      window.clearInterval(interval);
      unsubscribeConsent();
      video.removeEventListener('loadedmetadata', init);
      video.removeEventListener('timeupdate', onTimeUpdate);
      for (const type of TRACKED_EVENTS) video.removeEventListener(type, onPlayerEvent);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', flush);
    };
  }, [videoId, hitId, sessionIdProp, requireConsent]);

  return <video ref={ref} className="player" src={src} controls playsInline preload="metadata" />;
}
