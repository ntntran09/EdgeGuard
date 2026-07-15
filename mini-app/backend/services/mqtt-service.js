import mqtt from 'mqtt';

import { config, mqttUrl } from '../config.js';
import {
  createTransientImageBuffer,
  createTransientImageFromJson,
} from './image-store.js';
import { supabaseService } from './supabase-service.js';

const TELEMETRY_KEYS = {
  status: '/status',
  environment: '/telemetry/environment',
  security: '/telemetry/security',
  power: '/telemetry/power',
  system: '/telemetry/system',
  nfc: '/telemetry/nfc',
  modelInference: '/model/inference',
};
const MAX_OFFLINE_RFID_CARDS = 32;
const MIN_AUTO_LOCK_MS = 1000;
const MAX_AUTO_LOCK_MS = 60 * 60 * 1000;
const LIVE_FRAME_MAX_AGE_MS = 5000;

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function buildDeviceAccessPayload(settings = {}, rfidAllowlist = []) {
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

  if (key === 'modelInference') {
    if (typeof parsed.label === 'string') {
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
    },
    topics: {},
    summary: {},
    latestImage: null,
  };

  let client = null;
  let deviceAccessConfig = buildDeviceAccessPayload();
  let latestFrame = null;
  const frameSubscribers = new Set();

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
    await publish(`${topics.commandBase}/${command}`, JSON.stringify({
      requested_at: new Date().toISOString(),
      source: 'backend',
      payload,
    }));

    if (command === 'servo' && (payload.action === 'lock' || payload.action === 'unlock')) {
      snapshot.summary.doorOpen = payload.action === 'unlock';
      snapshot.summary.doorStateReason = 'command';
      snapshot.summary.updatedAt = new Date().toISOString();
    }
  }

  async function syncAccessConfig() {
    const storedConfig = await supabaseService.getDeviceAccessConfig(
      config.mqtt.deviceId,
      MAX_OFFLINE_RFID_CARDS
    );
    if (!storedConfig) {
      return { synced: false, reason: 'database_unavailable' };
    }

    deviceAccessConfig = buildDeviceAccessPayload(
      storedConfig.settings,
      storedConfig.rfidAllowlist
    );
    await publish(topics.config, JSON.stringify({
      ...deviceAccessConfig,
      requested_at: new Date().toISOString(),
      source: 'access_config_sync',
    }), { qos: 1, retain: true });

    console.log(
      `[MQTT] Synced access config: auto-lock ${deviceAccessConfig.auto_lock_enabled ? 'on' : 'off'} `
      + `after ${deviceAccessConfig.auto_lock_ms} ms, ${deviceAccessConfig.rfid_allowlist.length} RFID card(s)`
    );
    return { synced: true, config: deviceAccessConfig };
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
    const metadata = {
      topic,
      source: 'mqtt',
      deviceId: config.mqtt.deviceId,
    };

    const frame = topic === topics.imageJson
      ? createTransientImageFromJson(JSON.parse(payload.toString('utf8')), metadata)
      : createTransientImageBuffer(payload, metadata);
    const publicFrame = { ...frame };
    delete publicFrame.buffer;

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

    await supabaseService.insertAlert({
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
      await supabaseService.insertAlert({
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
        await supabaseService.recordPendingRfidScan({
          deviceId: config.mqtt.deviceId,
          tagId: normalizedTagId,
          thumbnailUrl: snapshot.latestImage?.base64,
        });
        return;
      }
    }

    await supabaseService.insertAlert({
      deviceId: config.mqtt.deviceId,
      alertType: 'rfid_invalid',
      message: `Thẻ RFID/NFC không hợp lệ: ${normalizedTagId}`,
      thumbnailUrl: snapshot.latestImage?.base64,
      metadata: { ...scanMetadata, reason: result.reason },
    });
  }

  function handleTelemetryMessage(topic, payload) {
    const receivedAt = new Date().toISOString();
    const { raw, parsed } = parsePayload(payload);
    const key = telemetryByTopic.get(topic);

    snapshot.connection.lastMessageAt = receivedAt;

    if (key) {
      snapshot.topics[key] = { topic, raw, parsed, receivedAt };
      snapshot.summary.updatedAt = receivedAt;
      summarizeTelemetry(snapshot.summary, key, parsed);

      if (key === 'modelInference' && parsed && typeof parsed === 'object') {
        supabaseService.insertAiLog({
          deviceId: config.mqtt.deviceId,
          label: parsed.label,
          confidence: parsed.confidence ?? parsed.score ?? parsed.anomaly_score,
          anomalyScore: parsed.anomaly_score,
          objectCount: parsed.object_count ?? parsed.people_count ?? 0,
          imagePath: snapshot.latestImage?.base64,
          telegramMsgLink: snapshot.latestImage?.telegramMsgLink,
          metadata: parsed,
        });
      } else if (key === 'security' && parsed && typeof parsed === 'object') {
        if (parsed.motion) {
          supabaseService.insertAlert({
            deviceId: config.mqtt.deviceId,
            alertType: 'motion',
            message: 'Phát hiện chuyển động (cảm biến)',
            thumbnailUrl: snapshot.latestImage?.base64,
          });
        }
        if (parsed.door_open) {
          supabaseService.insertAlert({
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
      ];

      client.subscribe(subscriptions, { qos: 0 }, (error) => {
        if (error) {
          console.error('[MQTT] Subscribe failed', error);
          return;
        }

        console.log('[MQTT] Subscribed:', subscriptions.join(', '));
      });

      syncAccessConfig().catch((error) => {
        console.error('[MQTT] Failed to sync access config after connect', error);
      });
    });

    client.on('message', (topic, payload, packet) => {
      if (topic === topics.imageRaw || topic === topics.imageJson) {
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
      return {
        ...snapshot,
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
    publishConfig(payload) {
      return publish(topics.config, JSON.stringify({
        ...payload,
        requested_at: new Date().toISOString(),
        source: 'api',
      }), { retain: true });
    },
    syncAccessConfig,
  };
}
