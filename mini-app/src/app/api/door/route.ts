import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { backendApiUrl } from '@/lib/backend-url';

const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';
const UNLOCK_ANGLE = Number(process.env.RFID_UNLOCK_ANGLE || 90);
const LOCK_ANGLE = Number(process.env.RFID_LOCK_ANGLE || 0);
const DEFAULT_AUTO_LOCK_SECONDS = 10;
const MIN_AUTO_LOCK_SECONDS = 1;
const MAX_AUTO_LOCK_SECONDS = 60 * 60;

async function getAutoLockConfig() {
  if (!isSupabaseConfigured) {
    return { enabled: true, milliseconds: DEFAULT_AUTO_LOCK_SECONDS * 1000 };
  }

  const { data, error } = await supabase
    .from('device_settings')
    .select('auto_lock_enabled,auto_lock_seconds')
    .eq('device_id', DEVICE_ID)
    .maybeSingle();

  if (error) {
    console.warn('[API /door] Could not load auto-lock setting, using default:', error.message);
  }

  const rawSeconds = Number(data?.auto_lock_seconds ?? DEFAULT_AUTO_LOCK_SECONDS);
  const seconds = Number.isFinite(rawSeconds)
    ? Math.min(MAX_AUTO_LOCK_SECONDS, Math.max(MIN_AUTO_LOCK_SECONDS, rawSeconds))
    : DEFAULT_AUTO_LOCK_SECONDS;

  return {
    enabled: data?.auto_lock_enabled !== false,
    milliseconds: Math.round(seconds * 1000),
  };
}

async function publishCommand(command: string, payload: Record<string, unknown>) {
  const res = await fetch(backendApiUrl('/api/mqtt/command'), {
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
    let autoLockMs: number | null = null;

    if (action === 'unlock') {
      const autoLock = await getAutoLockConfig();
      autoLockMs = autoLock.enabled ? autoLock.milliseconds : 0;
      await publishCommand('servo', {
        action: 'unlock',
        angle: UNLOCK_ANGLE,
        lock_angle: LOCK_ANGLE,
        auto_lock_ms: autoLockMs,
      });
    } else {
      await publishCommand('servo', { action: 'lock', angle: LOCK_ANGLE });
    }

    if (isSupabaseConfigured) {
      await supabase.from('alerts').insert([{
        device_id: DEVICE_ID,
        alert_type: action === 'unlock' ? 'door_unlocked' : 'door_locked',
        message: action === 'unlock'
          ? 'Người dùng mở cửa từ xa qua Mini App'
          : 'Người dùng khóa cửa từ xa qua Mini App',
        source: 'manual',
        severity: 'info',
        metadata: { action, auto_lock_ms: autoLockMs },
        resolved: true,
      }]);
    }

    return NextResponse.json({
      ok: true,
      command: action,
      doorOpen: action === 'unlock',
      autoLockMs,
    });
  } catch (error) {
    console.error('[API /door] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Cannot connect to device' },
      { status: 502 }
    );
  }
}
