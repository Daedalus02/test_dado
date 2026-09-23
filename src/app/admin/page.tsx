import type { Metadata } from 'next';
import Link from 'next/link';
import { DailyHitsChart, DecileChart, RetentionChart } from '@/components/admin/Charts';
import { videos } from '@/config';
import { formatPct, formatSeconds } from '@/lib/format';
import {
  dailyHits,
  hitCounters,
  isIsoDate,
  knownVideoIds,
  listHits,
  type HitFilters,
} from '@/lib/hits';
import { listSessions, type SessionRow } from '@/lib/sessions';
import { videoStats } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin', robots: { index: false } };

type SearchParams = Record<string, string | string[] | undefined>;

function param(sp: SearchParams, key: string): string | undefined {
  const value = sp[key];
  return typeof value === 'string' && value ? value : undefined;
}

const RECENT_SESSIONS = 10;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const from = param(searchParams, 'from');
  const to = param(searchParams, 'to');
  const filters: HitFilters = {
    videoId: param(searchParams, 'video'),
    from: isIsoDate(from) ? from : undefined,
    to: isIsoDate(to) ? to : undefined,
  };

  const [hits, counters, daily, seenIds, sessions] = await Promise.all([
    listHits(filters),
    hitCounters(filters),
    dailyHits(filters),
    knownVideoIds(),
    listSessions(filters),
  ]);

  const videoIds = [...new Set([...Object.keys(videos), ...seenIds])].sort();
  const sessionsByVideo = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const list = sessionsByVideo.get(s.video_id) ?? [];
    list.push(s);
    sessionsByVideo.set(s.video_id, list);
  }

  return (
    <main className="admin">
      <h1>Video Tracker · Admin</h1>

      <form className="filters" method="get">
        <label>
          Video
          <select name="video" defaultValue={filters.videoId ?? ''}>
            <option value="">Tutti</option>
            {videoIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dal
          <input type="date" name="from" defaultValue={filters.from} />
        </label>
        <label>
          Al
          <input type="date" name="to" defaultValue={filters.to} />
        </label>
        <button type="submit">Filtra</button>
        <Link href="/admin">Azzera</Link>
        <span className="muted">Date e orari in UTC</span>
      </form>

      <section className="cards">
        <Counter label="Accessi totali" value={counters.total} />
        <Counter label="Unici (IP + UA)" value={counters.uniques} />
        <Counter label="Oggi" value={counters.today} />
        <Counter label="Ultimi 7 giorni" value={counters.week} />
      </section>

      <h2>Accessi al giorno</h2>
      <div className="panel">
        {daily.length ? <DailyHitsChart data={daily} /> : <p className="muted">Nessun dato.</p>}
      </div>

      <h2>Visione per video</h2>
      {sessionsByVideo.size === 0 && <p className="muted">Nessuna sessione di visione registrata.</p>}
      {[...sessionsByVideo.entries()].map(([videoId, rows]) => (
        <VideoSection key={videoId} videoId={videoId} rows={rows} />
      ))}

      <h2>Accessi ({hits.length === 500 ? 'ultimi 500' : hits.length})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Video</th>
              <th>Source</th>
              <th>IP</th>
              <th>Paese</th>
              <th>Referer</th>
              <th>User agent</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id}>
                <td>{h.ts}</td>
                <td>{h.video_id}</td>
                <td>{h.source ?? '–'}</td>
                <td>{h.ip ?? '–'}</td>
                <td>{h.country ?? '–'}</td>
                <td className="ua" title={h.referer ?? undefined}>
                  {h.referer ?? '–'}
                </td>
                <td className="ua" title={h.ua ?? undefined}>
                  {h.ua ?? '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value.toLocaleString('it-IT')}</div>
    </div>
  );
}

function VideoSection({ videoId, rows }: { videoId: string; rows: SessionRow[] }) {
  const stats = videoStats(rows);
  return (
    <section className="video-block panel">
      <h3>
        {videos[videoId]?.title ?? videoId} <span className="muted">({videoId})</span>
      </h3>
      <div className="cards">
        <Counter label="Sessioni" value={stats.sessions} />
        <div className="card">
          <div className="label">Tasso completamento</div>
          <div className="value">{formatPct(stats.completionRate)}</div>
        </div>
        <div className="card">
          <div className="label">Tempo medio guardato</div>
          <div className="value">{formatSeconds(stats.avgWatched)}</div>
        </div>
      </div>
      <div className="grid-2">
        <div>
          <h3>Distribuzione punto massimo (decili della durata)</h3>
          <DecileChart data={stats.deciles} />
        </div>
        <div>
          <h3>Retention (% sessioni oltre il punto X)</h3>
          <RetentionChart data={stats.retention} />
        </div>
      </div>
      <h3 style={{ marginTop: '1rem' }}>Sessioni recenti</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Inizio</th>
              <th>Durata</th>
              <th>Punto max</th>
              <th>Guardato</th>
              <th>Completata</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, RECENT_SESSIONS).map((s) => (
              <tr key={s.id}>
                <td>{s.started_at.slice(0, 19)}</td>
                <td className="num">{formatSeconds(s.duration)}</td>
                <td className="num">{formatSeconds(s.max_time)}</td>
                <td className="num">{formatSeconds(s.watched_seconds)}</td>
                <td>{s.completed ? 'sì' : 'no'}</td>
                <td>
                  <Link href={`/admin/sessions/${s.id}`}>Dettaglio</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
