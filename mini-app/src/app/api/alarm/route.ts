import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({ active: true }));

    const res = await fetch(`${BACKEND_URL}/api/mqtt/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'alarm',
        payload: { active: body.active ?? true },
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
        device_id: process.env.MQTT_DEVICE_ID || 'device_001',
        alert_type: 'system_event',
        message: `Người dùng đã ${body.active ? 'bật' : 'tắt'} chuông báo động`,
        resolved: true,
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
