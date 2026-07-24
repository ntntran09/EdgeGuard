import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { backendApiUrl } from '@/lib/backend-url';
import { normalizeAiDetections } from '@/lib/ai-detections';

const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';
const DEFAULT_AUTO_LOCK_SECONDS = 10;
const AI_DETECTION_MAX_AGE_MS = 6000;

interface MqttInferenceSnapshot {
  receivedAt?: string;
  parsed?: unknown;
}

interface MqttStatusPayload {
  connection?: { connected?: boolean };
  summary?: Record<string, unknown>;
  latestImage?: { base64?: string; url?: string };
  topics?: { modelInference?: MqttInferenceSnapshot };
  topicBase?: string;
}

interface MqttCameraEndpoints {
  baseUrl?: string;
  captureUrl?: string;
  eventFrameUrl?: string;
  streamUrl?: string;
  healthUrl?: string;
  source?: string;
  discoveredAt?: string;
}

export const dynamic = 'force-dynamic';

function integrationStatus() {
  return {
    aiModelReady: Boolean(process.env.AI_MODEL_PATH || process.env.NEXT_PUBLIC_AI_MODEL_READY === 'true'),
    telegramEnabled: process.env.TELEGRAM_ENABLED === 'true',
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  };
}

function freshAiDetections(inference?: MqttInferenceSnapshot) {
  const receivedAtMs = inference?.receivedAt ? Date.parse(inference.receivedAt) : Number.NaN;
  if (!Number.isFinite(receivedAtMs) || Date.now() - receivedAtMs > AI_DETECTION_MAX_AGE_MS) {
    return [];
  }
  return normalizeAiDetections(inference?.parsed);
}

export async function GET() {
  try {
    const [res, settingsResult] = await Promise.all([
      fetch(backendApiUrl('/api/mqtt/status'), {
        cache: 'no-store',
      }),
      isSupabaseConfigured
        ? supabase
            .from('device_settings')
            .select('*')
            .eq('device_id', DEVICE_ID)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: 'Backend unavailable' },
        { status: 502 }
      );
    }

    if (settingsResult.error) {
      return NextResponse.json(
        { ok: false, error: settingsResult.error.message },
        { status: 400 }
      );
    }

    const data = await res.json() as MqttStatusPayload;
    const inference = data.topics?.modelInference;
    const aiDetections = freshAiDetections(inference);
    const cameraEndpoints = data.summary?.cameraEndpoints as MqttCameraEndpoints | undefined;
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
      cameraReady: data.summary?.cameraReady ?? false,
      cameraLastFrameAt: data.summary?.cameraLastFrameAt,
      cameraLastFrameBytes: data.summary?.cameraLastFrameBytes,
      cameraPublishFailures: data.summary?.cameraPublishFailures,
      cameraImagePublishingEnabled: typeof data.summary?.cameraImagePublishingEnabled === 'boolean'
        ? data.summary.cameraImagePublishingEnabled
        : settingsResult.data?.camera_image_publish_enabled ?? true,
      cameraEndpoints: cameraEndpoints ? {
        baseUrl: cameraEndpoints.baseUrl,
        captureUrl: cameraEndpoints.captureUrl,
        eventFrameUrl: cameraEndpoints.eventFrameUrl,
        streamUrl: cameraEndpoints.streamUrl,
        healthUrl: cameraEndpoints.healthUrl,
        frameProxyUrl: '/api/camera/frame',
        streamProxyUrl: '/api/camera/stream',
        mqttTopicBase: data.topicBase,
        source: 'mqtt',
        discoveredAt: cameraEndpoints.discoveredAt,
      } : undefined,
      aiDetectionEnabled: typeof data.summary?.aiDetectionEnabled === 'boolean'
        ? data.summary.aiDetectionEnabled
        : settingsResult.data?.ai_detection_enabled ?? process.env.AI_DETECTION_ENABLED === 'true',
      aiDetections,
      aiDetectionsAt: aiDetections.length ? inference?.receivedAt : undefined,
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
      { ok: false, error: 'Cannot reach backend', ...integrationStatus() },
      { status: 502 }
    );
  }
}
