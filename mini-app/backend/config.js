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

function ipv4Number(address) {
  const normalized = normalizeIpv4Address(address);
  if (!normalized) return null;
  return normalized.split('.').reduce(
    (number, octet) => ((number << 8) | Number(octet)) >>> 0,
    0
  );
}

function isSameSubnet(address, peerAddress, netmask) {
  const addressNumber = ipv4Number(address);
  const peerNumber = ipv4Number(peerAddress);
  const maskNumber = ipv4Number(netmask);
  return addressNumber !== null
    && peerNumber !== null
    && maskNumber !== null
    && (addressNumber & maskNumber) === (peerNumber & maskNumber);
}

function detectLanIpv4(preferredAddress, peerAddress) {
  const preferred = normalizeIpv4Address(preferredAddress);
  const peer = normalizeIpv4Address(peerAddress);
  const addresses = Object.entries(os.networkInterfaces())
    .flatMap(([name, items]) => (items || []).map((item) => ({ ...item, name })))
    .filter((item) => item && !item.internal && item.family === 'IPv4')
    .sort((left, right) => {
      const leftSameSubnet = peer && isSameSubnet(left.address, peer, left.netmask) ? 0 : 1;
      const rightSameSubnet = peer && isSameSubnet(right.address, peer, right.netmask) ? 0 : 1;
      if (leftSameSubnet !== rightSameSubnet) return leftSameSubnet - rightSameSubnet;

      const leftPreferred = preferred === left.address ? 0 : 1;
      const rightPreferred = preferred === right.address ? 0 : 1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;

      const virtualPattern = /warp|vpn|radmin|vethernet|virtual|tunnel|loopback/i;
      const leftVirtual = virtualPattern.test(left.name) ? 1 : 0;
      const rightVirtual = virtualPattern.test(right.name) ? 1 : 0;
      if (leftVirtual !== rightVirtual) return leftVirtual - rightVirtual;

      return privateIpv4Rank(left.address) - privateIpv4Rank(right.address);
    });
  return addresses[0]?.address || '127.0.0.1';
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

export function backendConfigForAddress(address, peerAddress) {
  const publicUrl = configuredBackendUrl
    || `http://${detectLanIpv4(address, peerAddress)}:${serverPort}`;
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
