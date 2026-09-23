import type { PlayerEvent } from './progress';
import type { SessionRow } from './sessions';

export interface DecileBucket {
  bucket: string;
  sessions: number;
}

export interface RetentionPoint {
  label: string;
  pct: number;
}

export interface VideoStats {
  sessions: number;
  completionRate: number;
  avgWatched: number;
  deciles: DecileBucket[];
  retention: RetentionPoint[];
}

/** Istogramma del max_time in 10 bucket, ciascuno = 10% della durata del video. */
export function decileHistogram(rows: SessionRow[]): DecileBucket[] {
  const counts = new Array<number>(10).fill(0);
  for (const r of rows) {
    if (!r.duration) continue;
    const idx = Math.min(9, Math.floor((r.max_time / r.duration) * 10));
    counts[Math.max(0, idx)]++;
  }
  return counts.map((sessions, i) => ({ bucket: `${i * 10}–${(i + 1) * 10}%`, sessions }));
}

/**
 * Curva di retention: % di sessioni con max_time >= X.
 * Passo di un minuto; per video sotto i 3 minuti si passa ai secondi (max ~30 punti).
 */
export function retentionCurve(rows: SessionRow[]): RetentionPoint[] {
  if (rows.length === 0) return [];
  const maxDuration = Math.max(...rows.map((r) => r.duration ?? r.max_time));
  if (maxDuration <= 0) return [];
  const byMinute = maxDuration >= 180;
  const step = byMinute ? 60 : Math.max(1, Math.ceil(maxDuration / 30));
  const points: RetentionPoint[] = [];
  for (let x = 0; x <= maxDuration; x += step) {
    const reached = rows.filter((r) => r.max_time >= x).length;
    points.push({
      label: byMinute ? `${x / 60}m` : `${x}s`,
      pct: Math.round((reached / rows.length) * 1000) / 10,
    });
  }
  return points;
}

export function videoStats(rows: SessionRow[]): VideoStats {
  const n = rows.length;
  return {
    sessions: n,
    completionRate: n ? rows.filter((r) => r.completed).length / n : 0,
    avgWatched: n ? rows.reduce((sum, r) => sum + r.watched_seconds, 0) / n : 0,
    deciles: decileHistogram(rows),
    retention: retentionCurve(rows),
  };
}

export interface PlaySegment {
  start: number;
  end: number;
}

/** Ricostruisce gli intervalli in riproduzione dalla sequenza di eventi. */
export function playSegments(events: PlayerEvent[], fallbackEnd: number): PlaySegment[] {
  const segments: PlaySegment[] = [];
  let start: number | null = null;
  const close = (end: number) => {
    if (start !== null && end > start) segments.push({ start, end });
    start = null;
  };
  for (const e of events) {
    switch (e.type) {
      case 'play':
        if (start === null) start = e.time;
        break;
      case 'seeked':
        // dopo un seek la riproduzione riprende dalla nuova posizione
        if (start !== null) start = e.time;
        break;
      case 'seeking':
      case 'pause':
      case 'ended':
        close(e.time);
        break;
    }
  }
  close(fallbackEnd);
  return segments;
}
