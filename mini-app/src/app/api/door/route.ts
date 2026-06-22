import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({ action: 'unlock' }));
    const action = body.action === 'lock' ? 'lock' : 'unlock';

    const res = await fetch(`${BACKEND_URL}/api/mqtt/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: action, payload: action === 'unlock' ? { duration_ms: 5000 } : {} }),
    });

    if (!res.ok) {
      const error = await res.text();
      return NextResponse.json(
        { ok: false, error: `Backend error: ${error}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    if (isSupabaseConfigured) {
      await supabase.from('alerts').insert([{
        device_id: DEVICE_ID,
        alert_type: action === 'unlock' ? 'door_unlocked' : 'door_locked',
        message: action === 'unlock'
          ? 'Người dùng mở cửa từ xa qua Mini App'
          : 'Người dùng khóa cửa từ xa qua Mini App',
        source: 'manual',
        severity: 'info',
        metadata: { action },
        resolved: true,
      }]);
    }

    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    console.error('[API /door] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Không thể kết nối đến thiết bị. Vui lòng thử lại.' },
      { status: 502 }
    );
  }
}
