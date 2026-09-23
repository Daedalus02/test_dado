export function formatSeconds(total: number | null | undefined): string {
  if (total == null || !Number.isFinite(total)) return '–';
  const s = Math.round(total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
