import { NextResponse } from 'next/server';
import { applyTick, parseTick, readJsonBody, TICK_MIN_INTERVAL_S } from '@/lib/progress';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const payload = parseTick(await readJsonBody(req));
  if (!payload) return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 });
  const accepted = await applyTick(payload);
  if (!accepted) {
    return NextResponse.json(
      { ok: false, error: 'rate limited' },
      { status: 429, headers: { 'Retry-After': String(TICK_MIN_INTERVAL_S) } },
    );
  }
  return NextResponse.json({ ok: true });
}
