import { NextResponse, type NextRequest } from 'next/server';

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};

/** Confronto a tempo costante (l'edge runtime non ha crypto.timingSafeEqual). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function decodeBasic(header: string | null): [string, string] | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6));
    const sep = decoded.indexOf(':');
    return sep < 0 ? null : [decoded.slice(0, sep), decoded.slice(sep + 1)];
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    return new NextResponse('Admin disabilitato: imposta ADMIN_USER e ADMIN_PASS', { status: 503 });
  }

  const creds = decodeBasic(req.headers.get('authorization'));
  // Entrambi i confronti vengono sempre eseguiti, per non rivelare quale campo è errato.
  const userOk = safeEqual(creds?.[0] ?? '', user);
  const passOk = safeEqual(creds?.[1] ?? '', pass);
  if (creds && userOk && passOk) return NextResponse.next();

  return new NextResponse('Autenticazione richiesta', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="video-tracker admin", charset="UTF-8"' },
  });
}
