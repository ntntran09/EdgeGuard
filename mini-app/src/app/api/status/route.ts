import { NextResponse } from 'next/server';
import { getExampleElapsedSeconds, getExampleEvents, getExampleFlow, isExampleAlerting, isExampleDoorOpen } from '@/lib/example-flow';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';
const DEFAULT_AUTO_LOCK_SECONDS = 10;

export const dynamic = 'force-dynamic';

function integrationStatus() {
  return {
    aiDetectionEnabled: process.env.AI_DETECTION_ENABLED === 'true',
    aiModelReady: Boolean(process.env.AI_MODEL_PATH || process.env.NEXT_PUBLIC_AI_MODEL_READY === 'true'),
    telegramEnabled: process.env.TELEGRAM_ENABLED === 'true',
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  };
}

export async function GET() {
  const exampleFlow = getExampleFlow();
  if (exampleFlow) {
    const events = getExampleEvents() || [];
    const latestDanger = events.find((event) => event.severity === 'danger' || event.severity === 'warning');

    return NextResponse.json({
      mqttConnected: true,
      doorOpen: isExampleDoorOpen(),
      motionDetected: events.length > 0,
      temperatureC: 28.4,
      humidityPct: 64,
      modelLabel: latestDanger ? latestDanger.type : 'normal',
      anomalyScore: isExampleAlerting() ? 0.91 : 0.08,
      lastUpdate: new Date().toISOString(),
      latestImageUrl: exampleFlow.videoUrl,
      autoLockEnabled: true,
      autoLockSeconds: 5,
      aiDetectionEnabled: true,
      aiModelReady: true,
      telegramEnabled: true,
      telegramConfigured: true,
      exampleMode: true,
      exampleFlow: exampleFlow.key,
      exampleLabel: exampleFlow.label,
      exampleElapsedSeconds: Math.floor(getExampleElapsedSeconds()),
    });
  }

  try {
    const [res, settingsResult] = await Promise.all([
      fetch(`${BACKEND_URL}/api/mqtt/status`, {
        next: { revalidate: 5 },
      }),
      isSupabaseConfigured
        ? supabase
            .from('device_settings')
            .select('auto_lock_enabled, auto_lock_seconds')
            .eq('device_id', DEVICE_ID)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: 'Backend unavailable' },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      mqttConnected: data.connection?.connected ?? false,
      doorOpen: data.summary?.doorOpen ?? false,
      motionDetected: data.summary?.motionDetected ?? false,
      temperatureC: data.summary?.temperatureC,
      humidityPct: data.summary?.humidityPct,
      modelLabel: data.summary?.modelLabel,
      anomalyScore: data.summary?.anomalyScore,
      lastUpdate: data.summary?.updatedAt,
      latestImageUrl: data.latestImage?.base64 || data.latestImage?.url,
      autoLockEnabled: settingsResult.data
        ? (settingsResult.data.auto_lock_enabled ?? settingsResult.data.auto_lock_seconds !== null)
        : false,
      autoLockSeconds: settingsResult.data && settingsResult.data.auto_lock_enabled !== false
        ? settingsResult.data.auto_lock_seconds ?? DEFAULT_AUTO_LOCK_SECONDS
        : null,
      ...integrationStatus(),
    });
  } catch (error) {
    console.error('[API /status] Error:', error);
    return NextResponse.json(
      {
        mqttConnected: false,
        doorOpen: false,
        motionDetected: false,
        error: 'Cannot reach backend',
        ...integrationStatus(),
      },
      { status: 200 }
    );
  }
}
