import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({ active: true }));
    const active = body.active ?? true;

    const res = await fetch(`${BACKEND_URL}/api/mqtt/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'alarm',
        payload: { active },
      }),
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
        alert_type: 'system_event',
        message: `Người dùng đã ${active ? 'bật' : 'tắt'} chuông báo động`,
        source: 'manual',
        severity: active ? 'warning' : 'info',
        resolved: !active,
      }]);
    }

    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    console.error('[API /alarm] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Không thể kích hoạt báo động. Vui lòng thử lại.' },
      { status: 502 }
    );
  }
}
