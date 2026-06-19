import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: numberFromEnv('PORT', 4000),
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },
  mqtt: {
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
};

export function mqttUrl() {
  if (config.mqtt.url) {
    return config.mqtt.url;
  }

  return `${config.mqtt.protocol}://${config.mqtt.host}:${config.mqtt.port}`;
}
