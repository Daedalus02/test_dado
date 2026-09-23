import { getDb, type SqlValue } from './db';

/** Sottoinsieme di Headers: va bene sia `headers()` di next/headers sia `Request.headers`. */
export interface HeaderSource {
  get(name: string): string | null;
}

const MAX_LEN = 512;

function clip(value: string | null | undefined, max = MAX_LEN): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function clientIp(headers: HeaderSource): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0];
  return clip(forwarded ?? headers.get('x-real-ip'), 64);
}

/** Paese ISO-3166 alpha-2 dall'header geo di Vercel, se presente. */
export function clientCountry(headers: HeaderSource): string | null {
  const country = headers.get('x-vercel-ip-country');
  return country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
}

/** Registra un accesso e restituisce l'id della riga creata. */
export async function logHit(
  videoId: string,
  source: string | null,
  request: HeaderSource,
): Promise<number | null> {
  const db = await getDb();
  const res = await db.run(
    `INSERT INTO hits (video_id, source, ip, ua, referer, country) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      videoId,
      clip(source, 64),
      clientIp(request),
      clip(request.get('user-agent')),
      clip(request.get('referer')),
      clientCountry(request),
    ],
  );
  return res.lastInsertRowid;
}

// ---------------------------------------------------------------------------
// Query per la dashboard

export interface HitFilters {
  videoId?: string;
  /** YYYY-MM-DD (UTC), inclusivo */
  from?: string;
  /** YYYY-MM-DD (UTC), inclusivo */
  to?: string;
}

export interface HitRow {
  id: number;
  video_id: string;
  source: string | null;
  ip: string | null;
  ua: string | null;
  referer: string | null;
  country: string | null;
  ts: string;
}

export interface HitCounters {
  total: number;
  uniques: number;
  today: number;
  week: number;
}

export interface DailyHits {
  day: string;
  hits: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | undefined): value is string {
  return !!value && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Costruisce la WHERE su una colonna timestamp (ts per hits, started_at per sessions). */
export function buildWhere(
  f: HitFilters,
  tsColumn: string,
): { sql: string; args: SqlValue[] } {
  const conds: string[] = [];
  const args: SqlValue[] = [];
  if (f.videoId) {
    conds.push('video_id = ?');
    args.push(f.videoId);
  }
  if (isIsoDate(f.from)) {
    conds.push(`${tsColumn} >= ?`);
    args.push(f.from);
  }
  if (isIsoDate(f.to)) {
    conds.push(`${tsColumn} < date(?, '+1 day')`);
    args.push(f.to);
  }
  return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', args };
}

export async function listHits(f: HitFilters, limit = 500): Promise<HitRow[]> {
  const db = await getDb();
  const where = buildWhere(f, 'ts');
  return db.all<HitRow>(
    `SELECT id, video_id, source, ip, ua, referer, country, ts
     FROM hits ${where.sql} ORDER BY ts DESC, id DESC LIMIT ?`,
    [...where.args, limit],
  );
}

export async function hitCounters(f: HitFilters): Promise<HitCounters> {
  const db = await getDb();
  const where = buildWhere(f, 'ts');
  const [row] = await db.all<HitCounters>(
    `SELECT
       COUNT(*) AS total,
       COUNT(DISTINCT COALESCE(ip, '') || '|' || COALESCE(ua, '')) AS uniques,
       COALESCE(SUM(CASE WHEN ts >= date('now') THEN 1 ELSE 0 END), 0) AS today,
       COALESCE(SUM(CASE WHEN ts >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS week
     FROM hits ${where.sql}`,
    where.args,
  );
  return row;
}

export async function dailyHits(f: HitFilters): Promise<DailyHits[]> {
  const db = await getDb();
  const where = buildWhere(f, 'ts');
  const rows = await db.all<DailyHits>(
    `SELECT date(ts) AS day, COUNT(*) AS hits FROM hits ${where.sql} GROUP BY day ORDER BY day`,
    where.args,
  );
  return fillDays(rows);
}

/** Inserisce i giorni senza accessi, così il grafico non "salta" i buchi. */
function fillDays(rows: DailyHits[]): DailyHits[] {
  if (rows.length < 2) return rows;
  const byDay = new Map(rows.map((r) => [r.day, r.hits]));
  const out: DailyHits[] = [];
  const end = Date.parse(rows[rows.length - 1].day);
  for (let t = Date.parse(rows[0].day); t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, hits: byDay.get(day) ?? 0 });
  }
  return out;
}

export async function knownVideoIds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.all<{ video_id: string }>(
    `SELECT DISTINCT video_id FROM hits ORDER BY video_id`,
  );
  return rows.map((r) => r.video_id);
}
