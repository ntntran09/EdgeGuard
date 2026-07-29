import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(workspaceRoot, '.env') });
dotenv.config({ path: path.join(serverRoot, '.env'), override: true });
dotenv.config({ path: path.join(serverRoot, '.env.local'), override: true });

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanFromEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  port: numberFromEnv('PORT', 4000),
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    imageBucket: process.env.SUPABASE_IMAGE_BUCKET ?? 'event-images',
  },
  mqtt: {
    enabled: booleanFromEnv('MQTT_ENABLED', true),
    url: process.env.MQTT_URL,
    protocol: process.env.MQTT_PROTOCOL ?? 'mqtt',
    host: process.env.MQTT_HOST ?? 'broker.hivemq.com',
    port: numberFromEnv('MQTT_PORT', 1883),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    deviceId: process.env.MQTT_DEVICE_ID ?? 'device_001',
    topicBase: process.env.MQTT_TOPIC_BASE ?? '/EdgeGuard/device_001',
  },
  images: {
    storageDir: path.resolve(serverRoot, process.env.IMAGE_STORAGE_DIR ?? './data/images'),
    maxBytes: numberFromEnv('MAX_IMAGE_BYTES', 5 * 1024 * 1024),
  },
  telegram: {
    enabled: process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    adminIds: process.env.ADMIN_TELEGRAM_IDS,
    authRequired: booleanFromEnv(
      'TELEGRAM_AUTH_REQUIRED',
      process.env.NODE_ENV === 'production'
    ),
    botUpdatesEnabled: booleanFromEnv('TELEGRAM_BOT_UPDATES_ENABLED', false),
    pollingTimeoutSeconds: numberFromEnv('TELEGRAM_POLLING_TIMEOUT_SECONDS', 25),
    pollingConflictBackoffSeconds: numberFromEnv('TELEGRAM_POLLING_CONFLICT_BACKOFF_SECONDS', 60),
  },
  email: {
    enabled: booleanFromEnv('EMAIL_ENABLED', true),
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    receiver: process.env.EMAIL_RECEIVER,
  },
  access: {
    allowAllRfid: booleanFromEnv('RFID_ALLOW_ALL', false),
    unlockAngle: numberFromEnv('RFID_UNLOCK_ANGLE', 90),
    lockAngle: numberFromEnv('RFID_LOCK_ANGLE', 0),
    unlockMs: numberFromEnv('RFID_UNLOCK_MS', 10000),
    buzzerMs: numberFromEnv('RFID_BUZZER_MS', 300),
    buzzerHz: numberFromEnv('RFID_BUZZER_HZ', 2200),
  },
  aws: {
    region: process.env.AWS_REGION ?? 'ap-southeast-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    rekognitionCollectionId: process.env.AWS_REKOGNITION_COLLECTION_ID ?? 'frontdoor',
  },
};

export function mqttUrl() {
  if (config.mqtt.url) {
    return config.mqtt.url;
  }

  return `${config.mqtt.protocol}://${config.mqtt.host}:${config.mqtt.port}`;
}
