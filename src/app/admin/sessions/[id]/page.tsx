import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EVENT_COLORS, SessionTimeline } from '@/components/admin/SessionTimeline';
import { formatSeconds } from '@/lib/format';
import { getSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sessione', robots: { index: false } };

export default async function SessionPage({ params }: { params: { id: string } }) {
  const session = await getSession(params.id);
  if (!session) notFound();

  const duration = session.duration ?? Math.max(session.max_time, ...session.events.map((e) => e.time), 1);

  return (
    <main className="admin">
      <p>
        <Link href={`/admin?video=${encodeURIComponent(session.video_id)}`}>← Dashboard</Link>
      </p>
      <h1>Sessione</h1>
      <p className="muted">
        <code>{session.id}</code> · video <strong>{session.video_id}</strong> · iniziata {session.started_at.slice(0, 19)} UTC ·
        ultimo aggiornamento {session.last_update.slice(0, 19)} UTC
      </p>

      <section className="cards">
        <Stat label="Durata video" value={formatSeconds(session.duration)} />
        <Stat label="Punto massimo" value={formatSeconds(session.max_time)} />
        <Stat label="Tempo guardato" value={formatSeconds(session.watched_seconds)} />
        <Stat label="Completata" value={session.completed ? 'sì' : 'no'} />
      </section>

      <h2>Timeline</h2>
      <div className="panel">
        {session.events.length ? (
          <SessionTimeline duration={duration} maxTime={session.max_time} events={session.events} />
        ) : (
          <p className="muted">Nessun evento registrato.</p>
        )}
      </div>

      <h2>Eventi ({session.events.length})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Evento</th>
              <th>Posizione</th>
            </tr>
          </thead>
          <tbody>
            {session.events.map((e, i) => (
              <tr key={i}>
                <td>{new Date(e.at).toISOString().replace('T', ' ').slice(0, 23)}</td>
                <td>
                  <span style={{ color: EVENT_COLORS[e.type] }}>●</span> {e.type}
                </td>
                <td className="num">{formatSeconds(e.time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
