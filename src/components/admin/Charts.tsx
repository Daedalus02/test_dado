'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyHits } from '@/lib/hits';
import type { DecileBucket, RetentionPoint } from '@/lib/stats';

const ACCENT = '#3b82f6';
const GRID = 'rgba(127, 127, 127, 0.2)';
const TICK = { fontSize: 11, fill: '#8a94a6' };

export function DailyHitsChart({ data }: { data: DailyHits[] }) {
  return (
    <div className="chart">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tick={TICK} />
          <YAxis allowDecimals={false} tick={TICK} />
          <Tooltip />
          <Bar dataKey="hits" name="Accessi" fill={ACCENT} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DecileChart({ data }: { data: DecileBucket[] }) {
  return (
    <div className="chart">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="bucket" tick={TICK} interval={0} angle={-30} textAnchor="end" height={44} />
          <YAxis allowDecimals={false} tick={TICK} />
          <Tooltip />
          <Bar dataKey="sessions" name="Sessioni" fill={ACCENT} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RetentionChart({ data }: { data: RetentionPoint[] }) {
  return (
    <div className="chart">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} />
          <YAxis domain={[0, 100]} unit="%" tick={TICK} />
          <Tooltip formatter={(v: number) => [`${v}%`, 'Sessioni oltre questo punto']} />
          <Area type="stepAfter" dataKey="pct" stroke={ACCENT} fill={ACCENT} fillOpacity={0.2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
