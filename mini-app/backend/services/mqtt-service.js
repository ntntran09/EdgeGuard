import mqtt from 'mqtt';

import { backendConfigForAddress, config, mqttUrl } from '../config.js';
import {
  createTransientImageBuffer,
  createTransientImageFromJson,
} from './image-store.js';
import { supabaseService } from './supabase-service.js';
import { rekognitionService } from './rekognition-service.js';

let lastAiLogTime = 0;
let lastAiLogEventKey = null;
const AI_LOG_COOLDOWN_MS = 8000;

const TELEMETRY_KEYS = {
  status: '/status',
  environment: '/telemetry/environment',
  security: '/telemetry/security',
  power: '/telemetry/power',
  system: '/telemetry/system',
  endpoints: '/telemetry/endpoints',
  nfc: '/telemetry/nfc',
  visionAlert: '/telemetry/vision-alert',
  modelInference: '/telemetry/inference',
};
const MAX_OFFLINE_RFID_CARDS = 32;
const MIN_AUTO_LOCK_MS = 1000;
const MAX_AUTO_LOCK_MS = 60 * 60 * 1000;
const LIVE_FRAME_MAX_AGE_MS = 5000;
const EVENT_FRAME_MAX_AGE_MS = 60 * 1000;
const MAX_CACHED_EVENT_FRAMES = 8;
const AI_MIN_CONFIDENCE = 0.7;
const EVENT_IMAGE_CAPTURE_TIMEOUT_MS = 6000;
const DEVICE_HTTP_TIMEOUT_MS = 2500;
const DEVICE_ONLINE_MAX_AGE_MS = 30 * 1000;

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function buildDeviceAccessPayload(
  settings = {},
  rfidAllowlist = [],
  backend = config.backend
) {
  const fallbackAutoLockMs = clampNumber(
    config.access.unlockMs,
    MIN_AUTO_LOCK_MS,
    MAX_AUTO_LOCK_MS,
    10000
  );
  const configuredAutoLockMs = settings.auto_lock_seconds === null
    || settings.auto_lock_seconds === undefined
    ? fallbackAutoLockMs
    : Number(settings.auto_lock_seconds) * 1000;
  const autoLockMs = clampNumber(
    configuredAutoLockMs,
    MIN_AUTO_LOCK_MS,
    MAX_AUTO_LOCK_MS,
    fallbackAutoLockMs
  );

  return {
    auto_lock_enabled: settings.auto_lock_enabled !== false,
    auto_lock_ms: autoLockMs,
    camera_publish_enabled: settings.camera_image_publish_enabled !== false,
    ai_detection_enabled: settings.ai_detection_enabled === true,
    object_left_alert_enabled: settings.object_left_alert_enabled !== false,
    stranger_alert_enabled: settings.stranger_alert_enabled !== false,
    vision_stable_alert_ms: clampNumber(
      Number(settings.object_left_max_seconds) * 1000,
      5000,
      60 * 60 * 1000,
      60 * 1000
    ),
    camera_blocked_alert_enabled: settings.camera_blocked_alert_enabled !== false,
    backend_url: backend.publicUrl,
    fomo_inference_url: backend.fomoInferenceUrl,
    lock_angle: clampNumber(config.access.lockAngle, 0, 180, 0),
    unlock_angle: clampNumber(config.access.unlockAngle, 0, 180, 90),
    rfid_allowlist: [...new Set(rfidAllowlist.map(normalizeTagId).filter(Boolean))]
      .slice(0, MAX_OFFLINE_RFID_CARDS),
  };
}

function parsePayload(payload) {
  const raw = payload.toString('utf8');

  if (!raw.length) {
    return { raw, parsed: null };
  }

  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch {
    return { raw, parsed: raw };
  }
}

function normalizeTagId(value) {
  if (value === null || value === undefined) return null;
  const tagId = String(value).trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  return tagId.length ? tagId : null;
}

function normalizeDeviceEndpoint(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') return null;
    if (endpoint.username || endpoint.password) return null;
    return endpoint.toString();
  } catch {
    return null;
  }
}

function cameraCaptureEndpoint(summary) {
  const endpoints = summary?.cameraEndpoints;
  if (!endpoints || typeof endpoints !== 'object') return null;

  const captureUrl = normalizeDeviceEndpoint(endpoints.captureUrl);
  if (captureUrl) return captureUrl;

  const baseUrl = normalizeDeviceEndpoint(endpoints.baseUrl);
  return baseUrl ? new URL('/capture', baseUrl).toString() : null;
}

function cameraEventFrameEndpoint(summary, eventId) {
  if (!Number.isInteger(eventId) || eventId <= 0) return null;
  const endpoints = summary?.cameraEndpoints;
  if (!endpoints || typeof endpoints !== 'object') return null;

  const announcedUrl = normalizeDeviceEndpoint(endpoints.eventFrameUrl);
  const baseUrl = normalizeDeviceEndpoint(endpoints.baseUrl);
  const endpoint = announcedUrl || (baseUrl ? new URL('/event-frame', baseUrl).toString() : null);
  if (!endpoint) return null;

  const url = new URL(endpoint);
  url.searchParams.set('event_id', String(eventId));
  return url.toString();
}

function summarizeTelemetry(summary, key, parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return;
  }

  if (key === 'environment') {
    summary.temperatureC = Number(parsed.temperature_c) || summary.temperatureC;
    summary.humidityPct = Number(parsed.humidity_pct) || summary.humidityPct;
    return;
  }

  if (key === 'security') {
    if (typeof parsed.motion === 'boolean') {
      summary.motionDetected = parsed.motion;
    }
    if (typeof parsed.door_open === 'boolean') {
      summary.doorOpen = parsed.door_open;
    }
    summary.distanceMm = Number(parsed.distance_mm) || summary.distanceMm;
    if (typeof parsed.alarm_active === 'boolean') {
      summary.alarmActive = parsed.alarm_active;
      summary.alarmSource = typeof parsed.alarm_source === 'string'
        ? parsed.alarm_source
        : summary.alarmSource;
    }
    return;
  }

  if (key === 'system') {
    if (typeof parsed.pn532_ready === 'boolean') {
      summary.pn532Ready = parsed.pn532_ready;
    }
    if (typeof parsed.camera_ready === 'boolean') {
      summary.cameraReady = parsed.camera_ready;
    }
    if (typeof parsed.door_open === 'boolean') {
      summary.doorOpen = parsed.door_open;
    }
    summary.cameraLastSuccessMs = Number(parsed.camera_last_success_ms) || 0;
    summary.cameraLastFrameBytes = Number(parsed.camera_last_frame_bytes) || 0;
    summary.cameraPublishFailures = Number(parsed.camera_publish_failures) || 0;
    if (typeof parsed.camera_publish_enabled === 'boolean') {
      summary.cameraImagePublishingEnabled = parsed.camera_publish_enabled;
    }
    if (typeof parsed.ai_detection_enabled === 'boolean') {
      summary.aiDetectionEnabled = parsed.ai_detection_enabled;
    }
    if (typeof parsed.camera_blocked_alert_enabled === 'boolean') {
      summary.cameraBlockedAlertEnabled = parsed.camera_blocked_alert_enabled;
    }
    if (typeof parsed.camera_blocked === 'boolean') {
      summary.cameraBlocked = parsed.camera_blocked;
    }
    if (typeof parsed.alarm_active === 'boolean') {
      summary.alarmActive = parsed.alarm_active;
      summary.alarmSource = typeof parsed.alarm_source === 'string'
        ? parsed.alarm_source
        : summary.alarmSource;
    }
    summary.fomoHttpLastStatus = Number(parsed.fomo_http_last_status) || 0;
    summary.fomoHttpLastSuccessMs = Number(parsed.fomo_http_last_success_ms) || 0;
    summary.fomoHttpFailures = Number(parsed.fomo_http_failures) || 0;
    if (typeof parsed.door_state_reason === 'string') {
      summary.doorStateReason = parsed.door_state_reason;
    }
    const lastNfcUid = normalizeTagId(parsed.last_nfc_uid);
    if (lastNfcUid) {
      summary.latestRfidUid = lastNfcUid;
      summary.latestRfidSeenAt = new Date().toISOString();
    }
    return;
  }

  if (key === 'endpoints') {
    const captureUrl = normalizeDeviceEndpoint(parsed.capture_url);
    const streamUrl = normalizeDeviceEndpoint(parsed.stream_url);
    const healthUrl = normalizeDeviceEndpoint(parsed.health_url);
    const eventFrameUrl = normalizeDeviceEndpoint(parsed.event_frame_url);
    const baseUrl = normalizeDeviceEndpoint(parsed.base_url);
    if (captureUrl || streamUrl || healthUrl || eventFrameUrl || baseUrl) {
      summary.cameraEndpoints = {
        baseUrl,
        captureUrl,
        eventFrameUrl,
        streamUrl,
        healthUrl,
        ip: typeof parsed.ip === 'string' ? parsed.ip : null,
        port: Number(parsed.port) || null,
        liveMode: typeof parsed.live_mode === 'string' ? parsed.live_mode : 'jpeg-polling',
        source: 'mqtt',
        discoveredAt: new Date().toISOString(),
      };
    }
    return;
  }

  if (key === 'modelInference') {
    const confidence = Number(parsed.confidence ?? parsed.score ?? parsed.anomaly_score);
    if (Number.isFinite(confidence) && confidence > AI_MIN_CONFIDENCE && typeof parsed.label === 'string') {
      summary.modelLabel = parsed.label;
    }
    summary.anomalyScore = Number(parsed.anomaly_score) || summary.anomalyScore;
    return;
  }

  if (key === 'nfc') {
    const tagId = normalizeTagId(parsed.uid ?? parsed.tag_id ?? parsed.card_uid);
    if (tagId) {
      summary.latestRfidUid = tagId;
      summary.latestRfidSeenAt = new Date().toISOString();
    }
  }
}

export function createMqttService() {
  const topicBase = config.mqtt.topicBase.replace(/\/$/, '');
  const topics = {
    commandBase: `${topicBase}/command`,
    config: `${topicBase}/command/config`,
    imageRaw: `${topicBase}/image`,
    imageJson: `${topicBase}/image/json`,
    eventImage: `${topicBase}/image/event/+`,
    telemetry: Object.fromEntries(
      Object.entries(TELEMETRY_KEYS).map(([key, suffix]) => [key, `${topicBase}${suffix}`])
    ),
  };
  const telemetryByTopic = new Map(
    Object.entries(topics.telemetry).map(([key, topic]) => [topic, key])
  );
  const snapshot = {
    connection: {
      connected: false,
      lastConnectedAt: null,
      lastMessageAt: null,
      lastHttpMessageAt: null,
      lastHttpCommandAt: null,
      activeTransport: null,
      deviceReportedOnline: null,
    },
    topics: {},
    summary: {},
    latestImage: null,
  };

  let client = null;
  let deviceAccessConfig = buildDeviceAccessPayload();
  let latestFrame = null;
  const eventFrames = new Map();
  const frameSubscribers = new Set();

  function currentBackendConfig() {
    return backendConfigForAddress(
      client?.stream?.localAddress,
      snapshot.summary.cameraEndpoints?.ip
    );
  }

  function deviceControlEndpoint(pathname) {
    const baseUrl = normalizeDeviceEndpoint(snapshot.summary.cameraEndpoints?.baseUrl);
    return baseUrl ? new URL(pathname, baseUrl).toString() : null;
  }

  async function postDeviceJson(pathname, body) {
    const endpoint = deviceControlEndpoint(pathname);
    if (!endpoint) throw new Error('Device HTTP endpoint has not been announced through MQTT.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEVICE_HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeGuard-Device-Id': config.mqtt.deviceId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Device HTTP ${response.status}.`);
      snapshot.connection.lastHttpCommandAt = new Date().toISOString();
      snapshot.connection.activeTransport = 'http';
      return response.json().catch(() => ({ ok: true }));
    } finally {
      clearTimeout(timeout);
    }
  }

  function publish(topic, payload, options = {}) {
    if (!client || !client.connected) {
      throw new Error('MQTT client is not connected.');
    }

    return new Promise((resolve, reject) => {
      client.publish(topic, payload, { qos: 1, retain: false, ...options }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async function publishDeviceCommand(command, payload = {}) {
    const envelope = {
      requested_at: new Date().toISOString(),
      source: 'backend',
      payload,
    };
    let transport = 'http';
    try {
      await postDeviceJson('/api/command', { command, ...envelope });
    } catch (httpError) {
      transport = 'mqtt';
      console.warn(`[Transport] HTTP command ${command} failed; using MQTT fallback:`, httpError.message);
      await publish(`${topics.commandBase}/${command}`, JSON.stringify(envelope));
      snapshot.connection.activeTransport = 'mqtt';
    }

    if (command === 'servo' && (payload.action === 'lock' || payload.action === 'unlock')) {
      snapshot.summary.doorOpen = payload.action === 'unlock';
      snapshot.summary.doorStateReason = 'command';
      snapshot.summary.updatedAt = new Date().toISOString();
    }
    if (command === 'alarm') {
      snapshot.summary.alarmActive = payload.active !== false;
      snapshot.summary.alarmSource = payload.source || 'manual';
      snapshot.summary.updatedAt = new Date().toISOString();
    }
    return { ok: true, command, transport };
  }

  async function publishBootstrapNetworkConfig() {
    const backend = currentBackendConfig();
    const networkConfig = {
      backend_url: backend.publicUrl,
      fomo_inference_url: backend.fomoInferenceUrl,
      requested_at: new Date().toISOString(),
      source: 'mqtt_bootstrap',
    };
    await publish(topics.config, JSON.stringify(networkConfig), { qos: 1, retain: true });
    return networkConfig;
  }

  async function syncAccessConfig() {
    const storedConfig = await supabaseService.getDeviceAccessConfig(
      config.mqtt.deviceId,
      MAX_OFFLINE_RFID_CARDS
    );
    const backend = currentBackendConfig();
    if (!storedConfig) {
      const networkConfig = await publishBootstrapNetworkConfig();
      console.warn(
        `[MQTT] Device settings unavailable; synced network config only: FOMO HTTP ${networkConfig.fomo_inference_url}`
      );
      return {
        synced: true,
        settingsSynced: false,
        reason: 'database_unavailable',
        config: networkConfig,
      };
    }

    deviceAccessConfig = buildDeviceAccessPayload(
      storedConfig.settings,
      storedConfig.rfidAllowlist,
      backend
    );
    const configEnvelope = {
      ...deviceAccessConfig,
      requested_at: new Date().toISOString(),
      source: 'access_config_sync',
    };
    let transport = 'http';
    try {
      await postDeviceJson('/api/config', configEnvelope);
      // Keep retained MQTT limited to the bootstrap network addresses. This is
      // intentionally the one configuration step that always remains on MQTT.
      await publishBootstrapNetworkConfig().catch((mqttError) => {
        console.warn('[MQTT] Could not refresh retained bootstrap config:', mqttError.message);
      });
    } catch (httpError) {
      transport = 'mqtt';
      console.warn('[Transport] HTTP config failed; using MQTT fallback:', httpError.message);
      await publish(topics.config, JSON.stringify(configEnvelope), { qos: 1, retain: true });
    }

    console.log(
      `[MQTT] Synced access config: auto-lock ${deviceAccessConfig.auto_lock_enabled ? 'on' : 'off'} `
      + `after ${deviceAccessConfig.auto_lock_ms} ms, camera live view `
      + `${deviceAccessConfig.camera_publish_enabled ? 'on' : 'off'}, AI detection `
      + `${deviceAccessConfig.ai_detection_enabled ? 'on' : 'off'}, camera-block alert `
      + `${deviceAccessConfig.camera_blocked_alert_enabled ? 'on' : 'off'}, `
      + `FOMO HTTP ${deviceAccessConfig.fomo_inference_url}, `
      + `${deviceAccessConfig.rfid_allowlist.length} RFID card(s)`
    );
    return { synced: true, transport, config: deviceAccessConfig };
  }

  async function pulseAccessActuators(tagId) {
    try {
      await publishDeviceCommand('servo', {
        action: 'unlock',
        angle: deviceAccessConfig.unlock_angle,
        lock_angle: deviceAccessConfig.lock_angle,
        auto_lock_ms: deviceAccessConfig.auto_lock_enabled ? deviceAccessConfig.auto_lock_ms : 0,
        tag_id: tagId,
      });
    } catch (error) {
      console.error('[MQTT] Failed to trigger access actuators', error);
    }
  }

  async function handleImageMessage(topic, payload) {
    const eventTopicPrefix = `${topicBase}/image/event/`;
    const eventId = topic.startsWith(eventTopicPrefix)
      ? Number(topic.slice(eventTopicPrefix.length))
      : null;
    const metadata = {
      topic,
      source: 'mqtt',
      deviceId: config.mqtt.deviceId,
      ...(Number.isInteger(eventId) && eventId > 0 ? { eventId } : {}),
    };

    const frame = topic === topics.imageJson
      ? createTransientImageFromJson(JSON.parse(payload.toString('utf8')), metadata)
      : createTransientImageBuffer(payload, metadata);
    const publicFrame = { ...frame };
    delete publicFrame.buffer;

    if (Number.isInteger(eventId) && eventId > 0) {
      eventFrames.set(eventId, frame);
      const now = Date.now();
      for (const [cachedEventId, cachedFrame] of eventFrames) {
        const receivedAt = Date.parse(cachedFrame.receivedAt);
        if (eventFrames.size > MAX_CACHED_EVENT_FRAMES
            || !Number.isFinite(receivedAt)
            || now - receivedAt > EVENT_FRAME_MAX_AGE_MS) {
          eventFrames.delete(cachedEventId);
        }
      }
      console.log(`[MQTT] Cached exact ${frame.bytes}-byte frame for event ${eventId}`);
      return;
    }

    latestFrame = frame;
    snapshot.latestImage = publicFrame;
    snapshot.summary.cameraReady = true;
    snapshot.summary.cameraLastFrameAt = frame.receivedAt;
    snapshot.summary.cameraLastFrameBytes = frame.buffer.length;
    snapshot.summary.updatedAt = frame.receivedAt;

    for (const subscriber of frameSubscribers) {
      try {
        subscriber(frame);
      } catch (error) {
        console.error('[MQTT] Live-frame subscriber failed', error);
      }
    }
  }

  async function captureEventImage({ eventId = null, exactFrame = false } = {}) {
    const captureUrl = exactFrame
      ? cameraEventFrameEndpoint(snapshot.summary, eventId)
      : cameraCaptureEndpoint(snapshot.summary);
    const fallbackImage = snapshot.latestImage?.base64;
    const cachedMqttEventImage = () => {
      const mqttEventFrame = exactFrame ? eventFrames.get(eventId) : null;
      const receivedAt = mqttEventFrame ? Date.parse(mqttEventFrame.receivedAt) : NaN;
      return mqttEventFrame
        && Number.isFinite(receivedAt)
        && Date.now() - receivedAt <= EVENT_FRAME_MAX_AGE_MS
        ? {
            imagePath: mqttEventFrame.base64,
            source: 'mqtt_exact_event_frame',
            capturedAt: mqttEventFrame.capturedAt || mqttEventFrame.receivedAt,
            eventId,
          }
        : null;
    };
    if (exactFrame && !captureUrl) {
      return cachedMqttEventImage()
        ?? { imagePath: null, source: 'exact_event_frame_unavailable', eventId };
    }

    // Nếu đã có frame MQTT mới (< 5s), dùng luôn, không cần fetch ESP32
    const frameAge = latestFrame ? Date.now() - new Date(latestFrame.receivedAt).getTime() : Infinity;
    if (!exactFrame && (!captureUrl || frameAge < 5000)) {
      return fallbackImage
        ? { imagePath: fallbackImage, source: 'mqtt_latest_frame' }
        : { imagePath: null, source: 'unavailable' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EVENT_IMAGE_CAPTURE_TIMEOUT_MS);

    try {
      const response = await fetch(captureUrl, {
        method: 'GET',
        headers: {
          Accept: 'image/jpeg,*/*',
          'User-Agent': 'EdgeGuard-Event-Capture/1.0',
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ESP32-CAM returned HTTP ${response.status}.`);
      }

      const responseEventId = response.headers.get('x-edgeguard-event-id');
      if (exactFrame && responseEventId !== String(eventId)) {
        throw new Error(`ESP32-CAM returned frame ${responseEventId || '(missing id)'} for event ${eventId}.`);
      }

      const contentType = (response.headers.get('content-type') || 'image/jpeg')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (!contentType.startsWith('image/')) {
        throw new Error('ESP32-CAM did not return an image.');
      }

      const frame = createTransientImageBuffer(Buffer.from(await response.arrayBuffer()), {
        contentType,
        topic: exactFrame ? `${topicBase}/camera/event-frame` : `${topicBase}/camera/capture`,
        source: exactFrame ? 'camera_exact_event_frame' : 'camera_event_capture',
        deviceId: config.mqtt.deviceId,
        ...(exactFrame ? {} : { capturedAt: new Date().toISOString() }),
      });
      if (!exactFrame) {
        const publicFrame = { ...frame };
        delete publicFrame.buffer;
        latestFrame = frame;
        snapshot.latestImage = publicFrame;
        snapshot.summary.cameraReady = true;
        snapshot.summary.cameraLastFrameAt = frame.receivedAt;
        snapshot.summary.cameraLastFrameBytes = frame.buffer.length;
        snapshot.summary.updatedAt = frame.receivedAt;
      }
      console.log(
        `[Camera HTTP] Captured ${frame.bytes}-byte ${exactFrame ? `exact frame for event ${eventId}` : 'camera frame'}`
      );

      return {
        imagePath: frame.base64,
        source: exactFrame ? 'camera_exact_event_frame' : 'camera_event_capture',
        capturedAt: frame.capturedAt,
        ...(exactFrame ? {
          eventId,
          frameUptimeMs: Number(response.headers.get('x-frame-uptime-ms')) || null,
        } : {}),
      };
    } catch (error) {
      console.error('[Camera HTTP] Could not capture a camera frame for AI event:', error);
      if (exactFrame) {
        const cachedAfterHttpFailure = cachedMqttEventImage();
        if (cachedAfterHttpFailure) return cachedAfterHttpFailure;
        return { imagePath: null, source: 'exact_event_frame_unavailable', eventId };
      }
      return fallbackImage
        ? { imagePath: fallbackImage, source: 'mqtt_latest_frame' }
        : { imagePath: null, source: 'capture_failed' };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function captureEventImageWithRetry(options = {}, maxAttempts = 3) {
    let result = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      result = await captureEventImage(options);
      if (result.imagePath) return { ...result, captureAttempts: attempt };
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    return { ...result, captureAttempts: maxAttempts };
  }

  async function recordAiInference(parsed, detections) {
    const eventId = Number(parsed.event_id);
    const eventImage = await captureEventImageWithRetry({ eventId, exactFrame: true });

    const isPersonDetected =
      String(parsed.label || '').toLowerCase().includes('person') ||
      String(parsed.label || '').toLowerCase().includes('human') ||
      String(parsed.label || '').toLowerCase().includes('người') ||
      Number(parsed.people_count) > 0 ||
      detections.some((d) => {
        const lbl = String(d.label || '').toLowerCase();
        return lbl.includes('person') || lbl.includes('human') || lbl.includes('người');
      });

    const now = Date.now();
    const eventKey = Number.isInteger(eventId) && eventId > 0
      ? `${eventId}:${Number(parsed.uptime_ms) || 'unknown'}`
      : null;
    const shouldLogDetection = eventKey
      ? eventKey !== lastAiLogEventKey
      : now - lastAiLogTime > AI_LOG_COOLDOWN_MS;
    if (shouldLogDetection) {
      lastAiLogTime = now;
      lastAiLogEventKey = eventKey;
      await supabaseService.insertAiLog({
        deviceId: config.mqtt.deviceId,
        label: parsed.label,
        confidence: Number(parsed.confidence ?? parsed.score ?? parsed.anomaly_score),
        anomalyScore: parsed.anomaly_score,
        objectCount: detections.length || parsed.object_count || parsed.people_count || 0,
        imagePath: eventImage.imagePath,
        telegramMsgLink: snapshot.latestImage?.telegramMsgLink,
        metadata: {
          ...parsed,
          detections,
          recognition_status: isPersonDetected ? 'pending' : 'not_applicable',
          event_image_source: eventImage.source,
          ...(eventImage.capturedAt ? { event_image_captured_at: eventImage.capturedAt } : {}),
          ...(Number.isInteger(eventImage.eventId)
            ? { event_image_event_id: eventImage.eventId }
            : {}),
          ...(Number.isFinite(eventImage.frameUptimeMs)
            ? { event_image_frame_uptime_ms: eventImage.frameUptimeMs }
            : {}),
        },
      });
    }

    let rekognitionResults = [];

    if (isPersonDetected && eventImage.imagePath) {
      try {
        rekognitionResults = await rekognitionService.analyzeFrame(eventImage.imagePath, 75);
        
        const faceDetections = [];
        const knownNames = [];
        let knownFaceCount = 0;
        let strangerCount = 0;

        for (const res of rekognitionResults) {
          let recognizedName = 'Người lạ';
          let isKnown = false;
          let similarity = res.similarity || 0;

          if (res.matched && res.faceId) {
            const knownFace = await supabaseService.lookupKnownFaceByRekognitionId(res.faceId);
            if (knownFace) {
              recognizedName = knownFace.display_name;
              isKnown = true;
              knownFaceCount++;
              if (!knownNames.includes(recognizedName)) {
                knownNames.push(recognizedName);
              }
            } else {
              strangerCount++;
            }
          } else {
            strangerCount++;
          }

          if (res.boundingBox && parsed.input_width && parsed.input_height) {
            const w = parsed.input_width;
            const h = parsed.input_height;
            const awsBbox = res.boundingBox;
            faceDetections.push({
              label: recognizedName,
              type: isKnown ? 'face_known' : 'face_stranger',
              confidence: similarity / 100,
              x: awsBbox.Left * w,
              y: awsBbox.Top * h,
              width: awsBbox.Width * w,
              height: awsBbox.Height * h
            });
          }
        }

        // FOMO may see a person whose face is not visible to Rekognition. Treat
        // every unmatched/missing face as a stranger instead of silently
        // accepting a partial match in a multi-person frame.
        const expectedPeopleCount = Math.max(1, Number(parsed.people_count) || 0);
        strangerCount = Math.max(strangerCount, expectedPeopleCount - knownFaceCount);
        const allPeopleAreKnown = knownFaceCount >= expectedPeopleCount && strangerCount === 0;

        if (Number.isInteger(eventId) && eventId >= 0) {
          await publishDeviceCommand('vision-result', {
            event_id: eventId,
            verified: true,
            known: allPeopleAreKnown,
            known_names: knownNames,
            stranger_count: strangerCount,
          });
        }

        // A familiar person is informational and can be recorded immediately.
        // Stranger alerts are emitted only after the device confirms that the
        // scene stayed below the 60% recheck threshold for five seconds.
        if (allPeopleAreKnown) {
          await insertAlertWithEventImage({
            deviceId: config.mqtt.deviceId,
            alertType: 'face_recognized',
            message: `Nhận diện người quen: ${knownNames.join(', ')}`,
            thumbnailUrl: eventImage.imagePath,
            severity: 'info',
            source: 'ai',
            metadata: {
              rekognition: rekognitionResults,
              recognized_name: knownNames.join(', ') || 'Người lạ',
              detections: faceDetections,
              input_width: parsed.input_width || 320,
              input_height: parsed.input_height || 240,
            },
          }, eventImage);
        }

      } catch (err) {
        console.error('[MQTT] Rekognition analyzeFrame inside recordAiInference failed:', err);
        if (Number.isInteger(eventId) && eventId >= 0) {
          await publishDeviceCommand('vision-result', {
            event_id: eventId,
            verified: false,
            known: false,
            stranger_count: 0,
            reason: 'recognition_failed',
          }).catch((publishError) => {
            console.error('[MQTT] Failed to return Rekognition error to device', publishError);
          });
        }
      }
    } else if (isPersonDetected && Number.isInteger(eventId) && eventId >= 0) {
      await publishDeviceCommand('vision-result', {
        event_id: eventId,
        verified: false,
        known: false,
        stranger_count: 0,
        reason: 'event_image_unavailable',
      });
    }

  }

  function metadataWithEventImage(metadata = {}, eventImage) {
    return {
      ...metadata,
      event_image_source: eventImage.source,
      ...(eventImage.capturedAt ? { event_image_captured_at: eventImage.capturedAt } : {}),
      ...(Number.isInteger(eventImage.eventId) ? { event_image_event_id: eventImage.eventId } : {}),
      ...(Number.isFinite(eventImage.frameUptimeMs)
        ? { event_image_frame_uptime_ms: eventImage.frameUptimeMs }
        : {}),
      ...(Number.isInteger(eventImage.captureAttempts)
        ? { event_image_capture_attempts: eventImage.captureAttempts }
        : {}),
    };
  }

  async function insertAlertWithEventImage(alert, eventImage) {
    const capturedImage = eventImage ?? await captureEventImageWithRetry();
    return supabaseService.insertAlert({
      ...alert,
      thumbnailUrl: capturedImage.imagePath || alert.thumbnailUrl,
      metadata: metadataWithEventImage(alert.metadata, capturedImage),
    });
  }

  async function recordVisionAlert(parsed) {
    const alertType = String(parsed.alert_type || parsed.label || '');
    const allowedAlerts = new Set(['stranger_detected', 'object_left', 'camera_blocked']);
    if (!allowedAlerts.has(alertType)) {
      console.warn(`[MQTT] Ignored unsupported vision alert type: ${alertType || '(empty)'}`);
      return;
    }

    const eventId = Number(parsed.event_id);
    if (typeof parsed.alarm_active === 'boolean') {
      snapshot.summary.alarmActive = parsed.alarm_active;
      snapshot.summary.alarmSource = parsed.alarm_active
        ? (parsed.alarm_source || 'vision')
        : null;
    }
    const eventImage = await captureEventImageWithRetry({ eventId, exactFrame: true });
    const alertMessages = {
      stranger_detected: 'Phát hiện người lạ đứng yên trong vùng quan sát',
      object_left: 'Phát hiện vật thể bị để lại trong vùng quan sát',
      camera_blocked: 'Phát hiện camera bị che hoặc mất tầm nhìn',
    };
    await insertAlertWithEventImage({
      deviceId: config.mqtt.deviceId,
      alertType,
      message: alertMessages[alertType],
      severity: alertType === 'object_left' ? 'warning' : 'danger',
      source: 'ai',
      metadata: parsed,
    }, eventImage);
  }

  async function handleRfidScan(tagId, metadata = {}) {
    const normalizedTagId = normalizeTagId(tagId);
    if (!normalizedTagId) return;

    const scanMetadata = {
      ...metadata,
      tag_id: normalizedTagId,
      raw_tag_id: tagId,
    };

    const result = config.access.allowAllRfid
      ? await supabaseService.recordRfidAccessGranted({
          deviceId: config.mqtt.deviceId,
          tagId: normalizedTagId,
          reason: 'test_allow_all',
        })
      : await supabaseService.validateRfid(normalizedTagId);

    await insertAlertWithEventImage({
      deviceId: config.mqtt.deviceId,
      alertType: 'rfid_scan',
      message: `Đã quét thẻ RFID/NFC: ${normalizedTagId}`,
      thumbnailUrl: snapshot.latestImage?.base64,
      severity: 'info',
      source: 'rfid',
      metadata: { ...scanMetadata, access_test_mode: config.access.allowAllRfid },
      resolved: true,
    });

    if (result.ok) {
      // New firmware opens cached active cards locally for instant/offline
      // access. Only send a servo command when the device did not already do it.
      if (metadata.local_access_granted !== true) {
        await pulseAccessActuators(normalizedTagId);
      }
      await insertAlertWithEventImage({
        deviceId: config.mqtt.deviceId,
        alertType: 'access_granted',
        message: `Mở cửa thành công bằng thẻ: ${normalizedTagId}`,
        thumbnailUrl: snapshot.latestImage?.base64,
        metadata: {
          ...scanMetadata,
          access_test_mode: config.access.allowAllRfid,
          card_id: result.credentialId,
          holder_name: result.holderName,
          reason: result.reason,
          opened_locally: metadata.local_access_granted === true,
          servo_angle: deviceAccessConfig.unlock_angle,
          servo_reset_angle: deviceAccessConfig.lock_angle,
          servo_reset_after_ms: deviceAccessConfig.auto_lock_enabled
            ? deviceAccessConfig.auto_lock_ms
            : null,
        },
        resolved: true,
      });
      return;
    }

    if (!config.access.allowAllRfid) {
      const settings = await supabaseService.getDeviceSettings(config.mqtt.deviceId);
      if (settings?.master_key_enabled) {
        const eventImage = await captureEventImageWithRetry();
        await supabaseService.recordPendingRfidScan({
          deviceId: config.mqtt.deviceId,
          tagId: normalizedTagId,
          thumbnailUrl: eventImage.imagePath,
          metadata: metadataWithEventImage({}, eventImage),
        });
        return;
      }
    }

    await insertAlertWithEventImage({
      deviceId: config.mqtt.deviceId,
      alertType: 'rfid_invalid',
      message: `Thẻ RFID/NFC không hợp lệ: ${normalizedTagId}`,
      thumbnailUrl: snapshot.latestImage?.base64,
      metadata: { ...scanMetadata, reason: result.reason },
    });
  }

  function receiveTelemetry(key, parsed, {
    topic = `/api/device/telemetry/${key}`,
    raw = JSON.stringify(parsed),
    transport = 'http',
  } = {}) {
    const receivedAt = new Date().toISOString();
    snapshot.connection.lastMessageAt = receivedAt;
    snapshot.connection.activeTransport = key === 'endpoints' && transport === 'mqtt'
      ? 'mqtt-bootstrap'
      : transport;
    if (transport === 'http') snapshot.connection.lastHttpMessageAt = receivedAt;
    if (key === 'status' && typeof parsed === 'string') {
      snapshot.connection.deviceReportedOnline = parsed.toLowerCase() === 'online';
    } else if (key) {
      snapshot.connection.deviceReportedOnline = true;
    }

    if (key) {
      snapshot.topics[key] = { topic, raw, parsed, receivedAt, transport };
      snapshot.summary.updatedAt = receivedAt;
      summarizeTelemetry(snapshot.summary, key, parsed);

      if (key === 'visionAlert' && parsed && typeof parsed === 'object') {
        recordVisionAlert(parsed).catch((error) => {
          console.error('[MQTT] Failed to record vision alert', error);
        });
      } else if (key === 'endpoints') {
        syncAccessConfig().catch((error) => {
          console.error('[MQTT] Failed to sync FOMO HTTP URL after endpoint discovery', error);
        });
      } else if (key === 'security' && parsed && typeof parsed === 'object') {
        if (parsed.motion) {
          insertAlertWithEventImage({
            deviceId: config.mqtt.deviceId,
            alertType: 'motion',
            message: 'Phát hiện chuyển động (cảm biến)',
            thumbnailUrl: snapshot.latestImage?.base64,
          });
        }
        if (parsed.door_open) {
          insertAlertWithEventImage({
            deviceId: config.mqtt.deviceId,
            alertType: 'door_open',
            message: 'Cửa đã được mở (cảm biến)',
            thumbnailUrl: snapshot.latestImage?.base64,
          });
        }
      } else if (key === 'nfc' && parsed && typeof parsed === 'object') {
        handleRfidScan(parsed.uid ?? parsed.tag_id ?? parsed.card_uid, {
          source_topic: topic,
          technology: parsed.technology,
          uid_length: parsed.uid_length,
          uptime_ms: parsed.uptime_ms,
          local_access_granted: parsed.local_access_granted === true,
          offline_rfid_count: parsed.offline_rfid_count,
        }).catch((error) => {
          console.error('[MQTT] Failed to handle RFID/NFC scan', error);
        });
      } else if (key === 'system' && parsed && parsed.rfid_scanned) {
        handleRfidScan(parsed.rfid_scanned, {
          source_topic: topic,
          legacy_field: 'rfid_scanned',
        }).catch((error) => {
          console.error('[MQTT] Failed to handle legacy RFID scan', error);
        });
      }
    }
    return { receivedAt };
  }

  function handleTelemetryMessage(topic, payload) {
    const { raw, parsed } = parsePayload(payload);
    const key = telemetryByTopic.get(topic);
    if (key === 'modelInference' && parsed && typeof parsed === 'object') {
      receiveFomoInference(parsed, 'mqtt');
      return;
    }
    receiveTelemetry(key, parsed, { topic, raw, transport: 'mqtt' });
  }

  function receiveFomoInference(parsed, transport = 'http') {
    const receivedAt = new Date().toISOString();
    const confidence = Number(parsed.confidence ?? parsed.score ?? parsed.anomaly_score);
    const detections = Array.isArray(parsed.detections)
      ? parsed.detections.filter((detection) => (
          detection
          && typeof detection === 'object'
          && Number(detection.confidence) > AI_MIN_CONFIDENCE
        ))
      : [];

    snapshot.connection.lastMessageAt = receivedAt;
    if (transport === 'http') snapshot.connection.lastHttpMessageAt = receivedAt;
    snapshot.connection.activeTransport = transport;
    snapshot.connection.deviceReportedOnline = true;
    snapshot.topics.modelInference = {
      topic: transport === 'http' ? '/api/fomo/inference' : topics.telemetry.modelInference,
      raw: JSON.stringify(parsed),
      parsed,
      receivedAt,
      transport,
    };
    snapshot.summary.updatedAt = receivedAt;
    summarizeTelemetry(snapshot.summary, 'modelInference', parsed);

    if (Number.isFinite(confidence) && confidence > AI_MIN_CONFIDENCE) {
      recordAiInference(parsed, detections).catch((error) => {
        console.error('[FOMO HTTP] Failed to record AI inference', error);
      });
    }
  }

  function getFomoHttpStatus() {
    const backend = currentBackendConfig();
    const inference = snapshot.topics.modelInference;
    return {
      inferenceUrl: backend.fomoInferenceUrl,
      expectedDeviceId: config.mqtt.deviceId,
      lastInferenceAt: inference?.receivedAt ?? null,
      lastEventId: Number(inference?.parsed?.event_id) || null,
      lastDetectionCount: Array.isArray(inference?.parsed?.detections)
        ? inference.parsed.detections.length
        : 0,
      deviceLastHttpStatus: snapshot.summary.fomoHttpLastStatus ?? null,
      deviceLastHttpSuccessMs: snapshot.summary.fomoHttpLastSuccessMs ?? null,
      deviceHttpFailures: snapshot.summary.fomoHttpFailures ?? 0,
    };
  }

  function start() {
    if (client) {
      return;
    }

    client = mqtt.connect(mqttUrl(), {
      clean: true,
      keepalive: 90,
      reconnectPeriod: 1000,
      username: config.mqtt.username,
      password: config.mqtt.password,
    });

    client.on('connect', () => {
      snapshot.connection.connected = true;
      snapshot.connection.lastConnectedAt = new Date().toISOString();
      const subscriptions = [
        ...Object.values(topics.telemetry),
        topics.imageRaw,
        topics.imageJson,
        topics.eventImage,
      ];

      client.subscribe(subscriptions, { qos: 0 }, (error) => {
        if (error) {
          console.error('[MQTT] Subscribe failed', error);
          return;
        }

        console.log('[MQTT] Subscribed:', subscriptions.join(', '));
      });

      publishBootstrapNetworkConfig().catch((error) => {
        console.error('[MQTT] Failed to sync bootstrap network config after connect', error);
      });
    });

    client.on('message', (topic, payload, packet) => {
      if (topic === topics.imageRaw
          || topic === topics.imageJson
          || topic.startsWith(`${topicBase}/image/event/`)) {
        if (packet.retain) {
          console.warn(`[MQTT] Removing stale retained image on ${topic}; waiting for a fresh camera frame`);
          client.publish(topic, Buffer.alloc(0), { qos: 1, retain: true }, (error) => {
            if (error) console.error('[MQTT] Failed to clear retained image', error);
          });
          return;
        }
        if (payload.length === 0) {
          return;
        }
        handleImageMessage(topic, payload).catch((error) => {
          console.error('[MQTT] Failed to handle image payload', error);
        });
        return;
      }

      handleTelemetryMessage(topic, payload);
    });

    client.on('close', () => {
      snapshot.connection.connected = false;
    });

    client.on('error', (error) => {
      console.error('[MQTT] Client error', error);
    });
  }

  function stop() {
    if (client) {
      client.end(true);
      client = null;
    }
  }

  return {
    start,
    stop,
    getStatus() {
      const latestFrameAge = latestFrame?.receivedAt
        ? Date.now() - Date.parse(latestFrame.receivedAt)
        : Number.POSITIVE_INFINITY;
      const latestImage = snapshot.latestImage && latestFrameAge <= LIVE_FRAME_MAX_AGE_MS
        ? { ...snapshot.latestImage, base64: undefined, url: '/api/mqtt/stream' }
        : null;
      const lastDeviceMessageMs = snapshot.connection.lastMessageAt
        ? Date.parse(snapshot.connection.lastMessageAt)
        : Number.NaN;
      const deviceConnected = Number.isFinite(lastDeviceMessageMs)
        && Date.now() - lastDeviceMessageMs <= DEVICE_ONLINE_MAX_AGE_MS
        && snapshot.connection.deviceReportedOnline !== false;
      return {
        ...snapshot,
        connection: {
          ...snapshot.connection,
          deviceConnected,
        },
        latestImage,
        topicBase,
        imageTopics: {
          raw: topics.imageRaw,
          json: topics.imageJson,
        },
      };
    },
    getLatestFrame() {
      return latestFrame;
    },
    subscribeToFrames(subscriber) {
      frameSubscribers.add(subscriber);
      const latestFrameAge = latestFrame?.receivedAt
        ? Date.now() - Date.parse(latestFrame.receivedAt)
        : Number.POSITIVE_INFINITY;
      if (latestFrame && latestFrameAge <= LIVE_FRAME_MAX_AGE_MS) subscriber(latestFrame);
      return () => frameSubscribers.delete(subscriber);
    },
    receiveFomoInference,
    receiveTelemetry,
    getFomoHttpStatus,
    publishJson(topic, message, options = {}) {
      return publish(topic, JSON.stringify(message), options);
    },
    publishCommand(command, payload = {}) {
      const safeCommand = command.trim();

      if (!/^[a-z0-9_-]+$/i.test(safeCommand)) {
        throw new Error('command must contain only letters, numbers, underscores, or hyphens.');
      }

      return publishDeviceCommand(safeCommand, payload);
    },
    async publishConfig(payload) {
      const backend = currentBackendConfig();
      const envelope = {
        ...payload,
        backend_url: backend.publicUrl,
        fomo_inference_url: backend.fomoInferenceUrl,
        requested_at: new Date().toISOString(),
        source: 'api',
      };
      try {
        await postDeviceJson('/api/config', envelope);
        await publishBootstrapNetworkConfig().catch((mqttError) => {
          console.warn('[MQTT] Could not refresh retained bootstrap config:', mqttError.message);
        });
        return { ok: true, transport: 'http' };
      } catch (httpError) {
        console.warn('[Transport] HTTP config API failed; using MQTT fallback:', httpError.message);
        await publish(topics.config, JSON.stringify(envelope), { retain: true });
        return { ok: true, transport: 'mqtt' };
      }
    },
    recordEvent({ alertType, message, severity, source, metadata, resolved = false }) {
      return insertAlertWithEventImage({
        deviceId: config.mqtt.deviceId,
        alertType,
        message,
        severity,
        source,
        metadata,
        resolved,
      });
    },
    syncAccessConfig,
  };
}
