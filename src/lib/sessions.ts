import { getDb } from './db';
import { buildWhere, type HitFilters } from './hits';
import type { PlayerEvent } from './progress';

export interface SessionRow {
  id: string;
  hit_id: number | null;
  video_id: string;
  duration: number | null;
  max_time: number;
  watched_seconds: number;
  completed: number;
  started_at: string;
  last_update: string;
}

export interface SessionDetail extends SessionRow {
  events: PlayerEvent[];
}

const COLUMNS = `id, hit_id, video_id, duration, max_time, watched_seconds, completed, started_at, last_update`;

export async function listSessions(f: HitFilters, limit = 5000): Promise<SessionRow[]> {
  const db = await getDb();
  const where = buildWhere(f, 'started_at');
  return db.all<SessionRow>(
    `SELECT ${COLUMNS} FROM sessions ${where.sql} ORDER BY started_at DESC LIMIT ?`,
    [...where.args, limit],
  );
}

export async function getSession(id: string): Promise<SessionDetail | null> {
  const db = await getDb();
  const [row] = await db.all<SessionRow & { events_json: string }>(
    `SELECT ${COLUMNS}, events_json FROM sessions WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  const { events_json, ...rest } = row;
  let events: PlayerEvent[] = [];
  try {
    const parsed: unknown = JSON.parse(events_json);
    if (Array.isArray(parsed)) events = parsed as PlayerEvent[];
  } catch {
    // eventi corrotti: si mostra la sessione senza timeline
  }
  events.sort((a, b) => a.at - b.at);
  return { ...rest, events };
}
