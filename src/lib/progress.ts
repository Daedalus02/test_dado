import { getVideo } from '@/config';
import { getDb, NOW_MS } from './db';

export const EVENT_TYPES = ['play', 'pause', 'seeking', 'seeked', 'ended'] as const;
export type PlayerEventType = (typeof EVENT_TYPES)[number];

export interface PlayerEvent {
  type: PlayerEventType;
  /** posizione nel video (s) */
  time: number;
  /** epoch ms lato client */
  at: number;
}

export interface InitPayload {
  sessionId: string;
  videoId: string;
  hitId: number | null;
  duration: number | null;
}

export interface TickPayload extends InitPayload {
  maxTime: number;
  /** secondi guardati dall'ultimo tick accettato (il server li somma) */
  watchedDelta: number;
  completed: boolean;
  events: PlayerEvent[];
  /** flush di chiusura pagina: non soggetto a rate limit */
  final: boolean;
}

export const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_TICK = 100;
/** Oltre questa dimensione gli eventi non vengono più accodati (anti-abuso). */
const MAX_EVENTS_JSON_LENGTH = 200_000;
/** Un tick non può aggiungere più di così (difesa contro valori gonfiati). */
const MAX_WATCHED_DELTA = 3600;
export const TICK_MIN_INTERVAL_S = 3;
const COMPLETION_RATIO = 0.95;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNeg(value: unknown): number {
  return Math.max(0, num(value) ?? 0);
}

function parseBase(body: Json): InitPayload | null {
  const { sessionId, videoId } = body;
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return null;
  if (typeof videoId !== 'string' || !getVideo(videoId)) return null;
  const hitId = num(body.hitId);
  const duration = num(body.duration);
  return {
    sessionId: sessionId.toLowerCase(),
    videoId,
    hitId: hitId !== null && Number.isInteger(hitId) ? hitId : null,
    duration: duration !== null && duration > 0 ? duration : null,
  };
}

function parseEvents(value: unknown): PlayerEvent[] {
  if (!Array.isArray(value)) return [];
  const events: PlayerEvent[] = [];
  for (const raw of value.slice(0, MAX_EVENTS_PER_TICK)) {
    if (!raw || typeof raw !== 'object') continue;
    const { type, time, at } = raw as Json;
    const t = num(time);
    const a = num(at);
    if (!EVENT_TYPES.includes(type as PlayerEventType) || t === null || a === null) continue;
    events.push({ type: type as PlayerEventType, time: Math.max(0, Math.round(t * 100) / 100), at: Math.round(a) });
  }
  return events;
}

export function parseInit(body: unknown): InitPayload | null {
  return body && typeof body === 'object' ? parseBase(body as Json) : null;
}

export function parseTick(body: unknown): TickPayload | null {
  if (!body || typeof body !== 'object') return null;
  const json = body as Json;
  const base = parseBase(json);
  if (!base) return null;
  let maxTime = nonNeg(json.maxTime);
  if (base.duration !== null) maxTime = Math.min(maxTime, base.duration);
  const completed =
    json.completed === true ||
    (base.duration !== null && maxTime >= COMPLETION_RATIO * base.duration);
  return {
    ...base,
    maxTime,
    watchedDelta: Math.min(nonNeg(json.watchedDelta), MAX_WATCHED_DELTA),
    completed,
    events: parseEvents(json.events),
    final: json.final === true,
  };
}

/** Legge il body come testo: sendBeacon invia text/plain, fetch application/json. */
export async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// hit_id viene accettato solo se esiste davvero e riguarda lo stesso video.
const HIT_REF = `(SELECT id FROM hits WHERE id = ? AND video_id = ?)`;

export async function initSession(p: InitPayload): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO sessions (id, hit_id, video_id, duration)
     VALUES (?, ${HIT_REF}, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       duration = COALESCE(excluded.duration, sessions.duration),
       hit_id = COALESCE(sessions.hit_id, excluded.hit_id),
       last_update = ${NOW_MS}
     WHERE sessions.video_id = excluded.video_id`,
    [p.sessionId, p.hitId, p.videoId, p.videoId, p.duration],
  );
}

/**
 * UPSERT del tick. Restituisce false se il tick è stato scartato dal rate limit
 * (o se la sessione appartiene a un altro video): il client lo ritenterà.
 */
export async function applyTick(p: TickPayload): Promise<boolean> {
  const db = await getDb();
  const eventsJson = JSON.stringify(p.events);
  const res = await db.run(
    `INSERT INTO sessions (id, hit_id, video_id, duration, max_time, watched_seconds, completed, events_json)
     VALUES (?, ${HIT_REF}, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       duration = COALESCE(excluded.duration, sessions.duration),
       hit_id = COALESCE(sessions.hit_id, excluded.hit_id),
       max_time = MAX(sessions.max_time, excluded.max_time),
       watched_seconds = sessions.watched_seconds + excluded.watched_seconds,
       completed = MAX(sessions.completed, excluded.completed),
       last_update = ${NOW_MS},
       events_json = CASE
         WHEN excluded.events_json = '[]' OR length(sessions.events_json) > ${MAX_EVENTS_JSON_LENGTH}
           THEN sessions.events_json
         WHEN sessions.events_json = '[]' THEN excluded.events_json
         ELSE substr(sessions.events_json, 1, length(sessions.events_json) - 1)
              || ',' || substr(excluded.events_json, 2)
       END
     WHERE sessions.video_id = excluded.video_id
       AND (? = 1 OR (julianday('now') - julianday(sessions.last_update)) * 86400 >= ${TICK_MIN_INTERVAL_S})`,
    [
      p.sessionId,
      p.hitId,
      p.videoId,
      p.videoId,
      p.duration,
      p.maxTime,
      p.watchedDelta,
      p.completed ? 1 : 0,
      eventsJson,
      p.final ? 1 : 0,
    ],
  );
  return res.changes > 0;
}
