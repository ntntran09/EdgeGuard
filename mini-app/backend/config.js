import path from 'node:path';
import os from 'node:os';
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

function normalizeHttpBaseUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function privateIpv4Rank(address) {
  if (address.startsWith('192.168.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 2;
  if (address.startsWith('10.')) return 3;
  if (address.startsWith('169.254.')) return 9;
  return 4;
}

function detectLanIpv4() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && !item.internal && item.family === 'IPv4')
    .map((item) => item.address)
    .sort((left, right) => privateIpv4Rank(left) - privateIpv4Rank(right));
  return addresses[0] || '127.0.0.1';
}

function appendUrlPath(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

function normalizeIpv4Address(value) {
  if (typeof value !== 'string') return null;
  const address = value.startsWith('::ffff:') ? value.slice(7) : value;
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => (
    !Number.isInteger(octet) || octet < 0 || octet > 255
  ))) {
    return null;
  }
  if (address === '0.0.0.0' || address.startsWith('127.')) return null;
  return address;
}

const serverPort = numberFromEnv('PORT', 3000);
const configuredBackendUrl = normalizeHttpBaseUrl(
  process.env.FOMO_HTTP_BASE_URL
    || process.env.BACKEND_PUBLIC_URL
);

export function backendConfigForAddress(address) {
  const publicUrl = configuredBackendUrl
    || `http://${normalizeIpv4Address(address) || detectLanIpv4()}:${serverPort}`;
  return {
    publicUrl,
    fomoInferenceUrl: appendUrlPath(publicUrl, '/api/fomo/inference'),
  };
}

export const config = {
  port: serverPort,
  backend: backendConfigForAddress(),
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
