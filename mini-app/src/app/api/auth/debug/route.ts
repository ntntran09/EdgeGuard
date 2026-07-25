import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type DebugBody = {
  reason?: unknown;
  href?: unknown;
  tgExists?: unknown;
  initDataLength?: unknown;
  platform?: unknown;
  status?: unknown;
  error?: unknown;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as DebugBody | null;
  const userAgent = request.headers.get('user-agent') || 'unknown';
  console.warn('[Telegram Auth Debug]', JSON.stringify({
    reason: String(body?.reason || 'unknown'),
    href: typeof body?.href === 'string' ? body.href.slice(0, 240) : null,
    tgExists: Boolean(body?.tgExists),
    initDataLength: Number(body?.initDataLength || 0),
    platform: typeof body?.platform === 'string' ? body.platform : null,
    status: typeof body?.status === 'number' ? body.status : null,
    error: typeof body?.error === 'string' ? body.error.slice(0, 240) : null,
    userAgent: userAgent.slice(0, 240),
  }));
  return NextResponse.json({ ok: true });
}