import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { requireAdmin } from '@/lib/server-auth';
import { syncDeviceAccessConfig } from '@/lib/device-sync';
import type { AlertConfig } from '@/types';

const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';
const DEFAULT_AUTO_LOCK_SECONDS = 10;
const MIN_AUTO_LOCK_SECONDS = 1;
const MAX_AUTO_LOCK_SECONDS = 60 * 60;

function normalizeAutoLockSeconds(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_AUTO_LOCK_SECONDS;
  return Math.round(Math.min(MAX_AUTO_LOCK_SECONDS, Math.max(MIN_AUTO_LOCK_SECONDS, seconds)));
}

const defaultAlertConfig: AlertConfig = {
  objectLeftAlertEnabled: true,
  objectLeftMaxSeconds: 60,
  autoLockEnabled: true,
  autoLockSeconds: DEFAULT_AUTO_LOCK_SECONDS,
  strangerAlertEnabled: true,
  cameraBlockedAlertEnabled: true,
  telegramAlertEnabled: false,
  cameraImagePublishingEnabled: true,
  aiDetectionEnabled: false,
  rfidCardConfigurationEnabled: false,
};

function databaseRequired() {
  return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
}

export async function GET() {
  if (!isSupabaseConfigured) return databaseRequired();

  const { data, error } = await supabase
    .from('device_settings')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ settings: defaultAlertConfig });
  }

  const settings: AlertConfig = {
    objectLeftAlertEnabled: data.object_left_alert_enabled ?? true,
    objectLeftMaxSeconds: data.object_left_max_seconds,
    autoLockEnabled: data.auto_lock_enabled ?? data.auto_lock_seconds !== null,
    autoLockSeconds: data.auto_lock_seconds ?? DEFAULT_AUTO_LOCK_SECONDS,
    strangerAlertEnabled: data.stranger_alert_enabled,
    cameraBlockedAlertEnabled: data.camera_blocked_alert_enabled,
    telegramAlertEnabled: data.telegram_alert_enabled || false,
    cameraImagePublishingEnabled: data.camera_image_publish_enabled ?? true,
    aiDetectionEnabled: data.ai_detection_enabled || false,
    rfidCardConfigurationEnabled: data.master_key_enabled || false,
  };

  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  try {
    const requester = await requireAdmin(request);
    if (!requester.ok) {
      return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
    }

    if (!isSupabaseConfigured) return databaseRequired();

    const body: Partial<AlertConfig> = await request.json();
    const autoLockSeconds = body.autoLockSeconds !== undefined
      ? normalizeAutoLockSeconds(body.autoLockSeconds)
      : undefined;
    const updates = {
      device_id: DEVICE_ID,
      ...(body.objectLeftAlertEnabled !== undefined && { object_left_alert_enabled: body.objectLeftAlertEnabled }),
      ...(body.objectLeftMaxSeconds !== undefined && { object_left_max_seconds: body.objectLeftMaxSeconds }),
      ...(body.autoLockEnabled !== undefined && { auto_lock_enabled: body.autoLockEnabled }),
      ...(autoLockSeconds !== undefined && { auto_lock_seconds: autoLockSeconds }),
      ...(body.strangerAlertEnabled !== undefined && { stranger_alert_enabled: body.strangerAlertEnabled }),
      ...(body.cameraBlockedAlertEnabled !== undefined && { camera_blocked_alert_enabled: body.cameraBlockedAlertEnabled }),
      ...(body.telegramAlertEnabled !== undefined && { telegram_alert_enabled: body.telegramAlertEnabled }),
      ...(body.cameraImagePublishingEnabled !== undefined && { camera_image_publish_enabled: body.cameraImagePublishingEnabled }),
      ...(body.aiDetectionEnabled !== undefined && { ai_detection_enabled: body.aiDetectionEnabled }),
      ...(body.rfidCardConfigurationEnabled !== undefined && { master_key_enabled: body.rfidCardConfigurationEnabled }),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('device_settings')
      .upsert(updates, { onConflict: 'device_id' });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const deviceSynced = await syncDeviceAccessConfig();
    return NextResponse.json({ ok: true, deviceSynced });
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid settings payload' }, { status: 400 });
  }
}
