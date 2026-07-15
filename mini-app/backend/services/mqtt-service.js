import mqtt from 'mqtt';

import { config, mqttUrl } from '../config.js';
import { saveImageBuffer, saveImageFromJson } from './image-store.js';
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

export function createMqttService({ onImageSaved } = {}) {
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
    return publish(`${topics.commandBase}/${command}`, JSON.stringify({
      requested_at: new Date().toISOString(),
      source: 'backend',
      payload,
    }));
  }

  async function pulseAccessActuators(tagId) {
    try {
      await Promise.all([
        publishDeviceCommand('servo', { angle: config.access.unlockAngle, tag_id: tagId }),
        publishDeviceCommand('buzzer', {
          enabled: true,
          duration_ms: config.access.buzzerMs,
          frequency_hz: config.access.buzzerHz,
          tag_id: tagId,
        }),
      ]);

      setTimeout(() => {
        publishDeviceCommand('servo', { angle: config.access.lockAngle, tag_id: tagId })
          .catch((error) => console.error('[MQTT] Failed to reset servo after RFID access', error));
      }, config.access.unlockMs);
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

    const image = topic === topics.imageJson
      ? await saveImageFromJson(JSON.parse(payload.toString('utf8')), metadata)
      : await saveImageBuffer(payload, metadata);

    snapshot.latestImage = image;

    if (onImageSaved) {
      await onImageSaved(image);
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
      message: `Da quet the RFID/NFC: ${normalizedTagId}`,
      thumbnailUrl: snapshot.latestImage?.base64,
      severity: 'info',
      source: 'rfid',
      metadata: { ...scanMetadata, access_test_mode: config.access.allowAllRfid },
      resolved: true,
    });

    if (result.ok) {
      await pulseAccessActuators(normalizedTagId);
      await supabaseService.insertAlert({
        deviceId: config.mqtt.deviceId,
        alertType: 'access_granted',
        message: `Mo cua thanh cong bang the: ${normalizedTagId}`,
        thumbnailUrl: snapshot.latestImage?.base64,
        metadata: {
          ...scanMetadata,
          access_test_mode: config.access.allowAllRfid,
          card_id: result.credentialId,
          holder_name: result.holderName,
          reason: result.reason,
          servo_angle: config.access.unlockAngle,
          servo_reset_angle: config.access.lockAngle,
          servo_reset_after_ms: config.access.unlockMs,
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
      message: `The RFID/NFC khong hop le: ${normalizedTagId}`,
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
            message: 'Phat hien chuyen dong (cam bien)',
            thumbnailUrl: snapshot.latestImage?.base64,
          });
        }
        if (parsed.door_open) {
          supabaseService.insertAlert({
            deviceId: config.mqtt.deviceId,
            alertType: 'door_open',
            message: 'Cua da duoc mo (cam bien)',
            thumbnailUrl: snapshot.latestImage?.base64,
          });
        }
      } else if (key === 'nfc' && parsed && typeof parsed === 'object') {
        handleRfidScan(parsed.uid ?? parsed.tag_id ?? parsed.card_uid, {
          source_topic: topic,
          technology: parsed.technology,
          uid_length: parsed.uid_length,
          uptime_ms: parsed.uptime_ms,
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
    });

    client.on('message', (topic, payload) => {
      if (topic === topics.imageRaw || topic === topics.imageJson) {
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
      return {
        ...snapshot,
        topicBase,
        imageTopics: {
          raw: topics.imageRaw,
          json: topics.imageJson,
        },
      };
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
  };
}
