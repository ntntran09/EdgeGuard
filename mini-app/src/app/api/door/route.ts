import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

export async function POST() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/mqtt/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'unlock', payload: { duration_ms: 5000 } }),
    });

    if (!res.ok) {
      const error = await res.text();
      return NextResponse.json(
        { ok: false, error: `Backend error: ${error}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    console.error('[API /door] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Không thể kết nối đến thiết bị. Vui lòng thử lại.' },
      { status: 502 }
    );
  }
}
