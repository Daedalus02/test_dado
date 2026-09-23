import { formatSeconds } from '@/lib/format';
import type { PlayerEvent, PlayerEventType } from '@/lib/progress';
import { playSegments } from '@/lib/stats';

export const EVENT_COLORS: Record<PlayerEventType, string> = {
  play: '#16a34a',
  pause: '#f59e0b',
  seeking: '#a855f7',
  seeked: '#6366f1',
  ended: '#dc2626',
};

interface Props {
  duration: number;
  maxTime: number;
  events: PlayerEvent[];
}

/** Barra della durata del video con i tratti riprodotti e un marker per ogni evento. */
export function SessionTimeline({ duration, maxTime, events }: Props) {
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;
  const segments = playSegments(events, maxTime);

  return (
    <>
      <div className="timeline" role="img" aria-label="Timeline eventi della sessione">
        {segments.map((seg, i) => (
          <div
            key={`s${i}`}
            className="segment"
            style={{ left: pct(seg.start), width: `calc(${pct(seg.end)} - ${pct(seg.start)})` }}
            title={`Riproduzione ${formatSeconds(seg.start)} → ${formatSeconds(seg.end)}`}
          />
        ))}
        {events.map((e, i) => (
          <div
            key={`e${i}`}
            className="marker"
            style={{ left: pct(e.time), background: EVENT_COLORS[e.type] }}
            title={`${e.type} @ ${formatSeconds(e.time)} — ${new Date(e.at).toLocaleString('it-IT')}`}
          />
        ))}
        <div className="max" style={{ left: pct(maxTime) }} title={`Punto massimo ${formatSeconds(maxTime)}`} />
        <span className="axis" style={{ left: 0 }}>
          0:00
        </span>
        <span className="axis" style={{ right: 0 }}>
          {formatSeconds(duration)}
        </span>
      </div>
      <div className="legend">
        <span style={{ ['--swatch' as string]: 'rgb(37 99 235 / 0.35)' }}>riproduzione</span>
        {Object.entries(EVENT_COLORS).map(([type, color]) => (
          <span key={type} style={{ ['--swatch' as string]: color }}>
            {type}
          </span>
        ))}
        <span>┆ punto massimo</span>
      </div>
    </>
  );
}
