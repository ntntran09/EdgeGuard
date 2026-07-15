import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';
const UNLOCK_ANGLE = Number(process.env.RFID_UNLOCK_ANGLE || 90);
const LOCK_ANGLE = Number(process.env.RFID_LOCK_ANGLE || 0);
const UNLOCK_MS = Number(process.env.RFID_UNLOCK_MS || 3000);

async function publishCommand(command: string, payload: Record<string, unknown>) {
  const res = await fetch(`${BACKEND_URL}/api/mqtt/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, payload }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Backend error: ${error}`);
  }

  return res.json();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({ action: 'unlock' }));
    const action = body.action === 'lock' ? 'lock' : 'unlock';

    if (action === 'unlock') {
      await Promise.all([
        publishCommand('servo', { angle: UNLOCK_ANGLE }),
        publishCommand('buzzer', { enabled: true, duration_ms: 300, frequency_hz: 2200 }),
      ]);
      setTimeout(() => {
        publishCommand('servo', { angle: LOCK_ANGLE }).catch((error) => {
          console.error('[API /door] Failed to reset servo:', error);
        });
      }, UNLOCK_MS);
    } else {
      await publishCommand('servo', { angle: LOCK_ANGLE });
    }

    if (isSupabaseConfigured) {
      await supabase.from('alerts').insert([{
        device_id: DEVICE_ID,
        alert_type: action === 'unlock' ? 'door_unlocked' : 'door_locked',
        message: action === 'unlock'
          ? 'Nguoi dung mo cua tu xa qua Mini App'
          : 'Nguoi dung khoa cua tu xa qua Mini App',
        source: 'manual',
        severity: 'info',
        metadata: { action },
        resolved: true,
      }]);
    }

    return NextResponse.json({ ok: true, command: action });
  } catch (error) {
    console.error('[API /door] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Cannot connect to device' },
      { status: 502 }
    );
  }
}
