import { NextResponse } from 'next/server';
import { initSession, parseInit, readJsonBody } from '@/lib/progress';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const payload = parseInit(await readJsonBody(req));
  if (!payload) return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 });
  await initSession(payload);
  return NextResponse.json({ ok: true });
}
