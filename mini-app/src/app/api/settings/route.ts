import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { defaultAlertConfig } from '@/lib/mock-data';
import type { AlertConfig } from '@/types';

const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ settings: defaultAlertConfig });
  }

  const { data, error } = await supabase
    .from('device_settings')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ settings: defaultAlertConfig });
  }

  if (!data) {
    return NextResponse.json({ settings: defaultAlertConfig });
  }

  const settings: AlertConfig = {
    objectLeftMaxSeconds: data.object_left_max_seconds,
    strangerAlertEnabled: data.stranger_alert_enabled,
    cameraBlockedAlertEnabled: data.camera_blocked_alert_enabled,
    masterKeyEnabled: data.master_key_enabled || false,
  };

  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  try {
    const body: Partial<AlertConfig> = await request.json();

    if (!isSupabaseConfigured) {
      return NextResponse.json({ ok: true });
    }

    const updates = {
      device_id: DEVICE_ID,
      ...(body.objectLeftMaxSeconds !== undefined && { object_left_max_seconds: body.objectLeftMaxSeconds }),
      ...(body.strangerAlertEnabled !== undefined && { stranger_alert_enabled: body.strangerAlertEnabled }),
      ...(body.cameraBlockedAlertEnabled !== undefined && { camera_blocked_alert_enabled: body.cameraBlockedAlertEnabled }),
      ...(body.masterKeyEnabled !== undefined && { master_key_enabled: body.masterKeyEnabled }),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('device_settings')
      .upsert(updates, { onConflict: 'device_id' });

    if (error) {
      console.log('[API /settings] POST Supabase Error:', error.message);
      return NextResponse.json({ ok: false, error: 'Database error' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    console.log('[API /settings] POST parsing Error');
    return NextResponse.json({ ok: false, error: 'Dữ liệu không hợp lệ' }, { status: 400 });
  }
}
