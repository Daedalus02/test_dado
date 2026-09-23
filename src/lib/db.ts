import fs from 'node:fs';
import path from 'node:path';

export type SqlValue = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | null;
}

/** Interfaccia minima comune a better-sqlite3 (locale) e Turso/libSQL (produzione). */
export interface Db {
  all<T>(sql: string, args?: SqlValue[]): Promise<T[]>;
  run(sql: string, args?: SqlValue[]): Promise<RunResult>;
}

/** Timestamp UTC con millisecondi (serve al rate limit dei tick). */
export const NOW_MS = `(strftime('%Y-%m-%d %H:%M:%f', 'now'))`;

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS hits (
    id INTEGER PRIMARY KEY,
    video_id TEXT NOT NULL,
    source TEXT,
    ip TEXT,
    ua TEXT,
    referer TEXT,
    country TEXT,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_hits_video_ts ON hits (video_id, ts)`,
  `CREATE INDEX IF NOT EXISTS idx_hits_ts ON hits (ts)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    hit_id INTEGER REFERENCES hits(id),
    video_id TEXT NOT NULL,
    duration REAL,
    max_time REAL NOT NULL DEFAULT 0,
    watched_seconds REAL NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT 0,
    started_at DATETIME DEFAULT ${NOW_MS},
    last_update DATETIME DEFAULT ${NOW_MS},
    events_json TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_video_started ON sessions (video_id, started_at)`,
];

async function openTurso(url: string, authToken: string): Promise<Db> {
  // Client HTTP: niente binding nativi, adatto a Vercel.
  const { createClient } = await import('@libsql/client/web');
  const client = createClient({ url, authToken });
  await client.batch(SCHEMA, 'write');
  return {
    async all<T>(sql: string, args: SqlValue[] = []) {
      const res = await client.execute({ sql, args });
      return res.rows.map(
        (row) => Object.fromEntries(res.columns.map((col, i) => [col, row[i]])) as T,
      );
    },
    async run(sql, args = []) {
      const res = await client.execute({ sql, args });
      return {
        changes: res.rowsAffected,
        lastInsertRowid: res.lastInsertRowid == null ? null : Number(res.lastInsertRowid),
      };
    },
  };
}

async function openSqlite(): Promise<Db> {
  const { default: Database } = await import('better-sqlite3');
  const file = path.resolve(process.env.SQLITE_PATH ?? path.join('data', 'video-tracker.db'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  for (const stmt of SCHEMA) sqlite.exec(stmt);
  return {
    async all<T>(sql: string, args: SqlValue[] = []) {
      return sqlite.prepare(sql).all(...args) as T[];
    },
    async run(sql, args = []) {
      const res = sqlite.prepare(sql).run(...args);
      return { changes: res.changes, lastInsertRowid: Number(res.lastInsertRowid) };
    },
  };
}

// Cache su globalThis: sopravvive all'hot reload di `next dev`.
const globalForDb = globalThis as unknown as { __videoTrackerDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__videoTrackerDb) {
    const { TURSO_DATABASE_URL: tursoUrl, TURSO_AUTH_TOKEN: tursoToken } = process.env;
    const opening = tursoUrl && tursoToken ? openTurso(tursoUrl, tursoToken) : openSqlite();
    // Se l'apertura fallisce, il prossimo tentativo riparte da zero.
    opening.catch(() => {
      globalForDb.__videoTrackerDb = undefined;
    });
    globalForDb.__videoTrackerDb = opening;
  }
  return globalForDb.__videoTrackerDb;
}
