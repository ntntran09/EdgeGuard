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

  if (key === 'modelInference') {
    if (typeof parsed.label === 'string') {
      summary.modelLabel = parsed.label;
    }
    summary.anomalyScore = Number(parsed.anomaly_score) || summary.anomalyScore;
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
          confidence: parsed.anomaly_score,
          imagePath: snapshot.latestImage?.base64,
          telegramMsgLink: snapshot.latestImage?.telegramMsgLink,
        });
      } else if (key === 'security' && parsed && typeof parsed === 'object') {
        if (parsed.motion) {
          supabaseService.insertAlert({
            deviceId: config.mqtt.deviceId,
            alertType: 'motion',
            message: 'Phát hiện chuyển động (Cảm biến)',
            thumbnailUrl: snapshot.latestImage?.base64,
          });
        }
        if (parsed.door_open) {
          supabaseService.insertAlert({
            deviceId: config.mqtt.deviceId,
            alertType: 'door_open',
            message: 'Cửa đã được mở (Cảm biến)',
            thumbnailUrl: snapshot.latestImage?.base64,
          });
        }
      } else if (key === 'system' && parsed && parsed.rfid_scanned) {
        // Optional: handle RFID scanned telemetry
        supabaseService.validateRfid(parsed.rfid_scanned).then((isValid) => {
          if (!isValid) {
            supabaseService.insertAlert({
              deviceId: config.mqtt.deviceId,
              alertType: 'rfid_invalid',
              message: `Thẻ RFID không hợp lệ: ${parsed.rfid_scanned}`,
              thumbnailUrl: snapshot.latestImage?.base64,
            });
          } else {
            supabaseService.insertAlert({
              deviceId: config.mqtt.deviceId,
              alertType: 'access_granted',
              message: `Mở cửa thành công bằng thẻ: ${parsed.rfid_scanned}`,
              thumbnailUrl: snapshot.latestImage?.base64,
            });
          }
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

      return publish(`${topics.commandBase}/${safeCommand}`, JSON.stringify({
        requested_at: new Date().toISOString(),
        source: 'api',
        payload,
      }));
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
