import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';

const MIME_TO_EXTENSION = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/bmp', '.bmp'],
]);

export async function ensureImageStorage() {
  await fs.mkdir(config.images.storageDir, { recursive: true });
}

export function safeImageFilename(filename) {
  if (typeof filename !== 'string') {
    return null;
  }

  const base = path.basename(filename);

  if (!/^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(base)) {
    return null;
  }

  return base;
}

function detectImageType(buffer, contentType) {
  if (contentType && MIME_TO_EXTENSION.has(contentType.toLowerCase())) {
    return {
      contentType: contentType.toLowerCase(),
      extension: MIME_TO_EXTENSION.get(contentType.toLowerCase()),
    };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: '.jpg' };
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { contentType: 'image/png', extension: '.png' };
  }

  if (buffer.slice(0, 3).toString('ascii') === 'GIF') {
    return { contentType: 'image/gif', extension: '.gif' };
  }

  if (buffer.slice(0, 2).toString('ascii') === 'BM') {
    return { contentType: 'image/bmp', extension: '.bmp' };
  }

  if (buffer.length >= 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return { contentType: 'image/webp', extension: '.webp' };
  }

  throw new Error('Unsupported image payload. Expected JPEG, PNG, GIF, BMP, or WebP.');
}

function assertImageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Image payload is empty.');
  }

  if (buffer.length > config.images.maxBytes) {
    throw new Error(`Image payload exceeds ${config.images.maxBytes} bytes.`);
  }
}

export function createTransientImageBuffer(buffer, metadata = {}) {
  assertImageSize(buffer);

  const detected = detectImageType(buffer, metadata.contentType);
  const receivedAt = new Date().toISOString();
  return {
    buffer,
    bytes: buffer.length,
    contentType: detected.contentType,
    topic: metadata.topic,
    source: metadata.source ?? 'mqtt',
    deviceId: metadata.deviceId,
    capturedAt: metadata.capturedAt,
    receivedAt,
    base64: `data:${detected.contentType};base64,${buffer.toString('base64')}`,
  };
}

export function createTransientImageFromJson(payload, metadata = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Image JSON payload must be an object.');
  }

  const imageBase64 = payload.image_base64 ?? payload.imageBase64 ?? payload.data;
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    throw new Error('Image JSON payload requires image_base64.');
  }

  const dataUrlMatch = imageBase64.match(/^data:([^;,]+);base64,(.+)$/);
  const buffer = Buffer.from(dataUrlMatch?.[2] ?? imageBase64, 'base64');
  return createTransientImageBuffer(buffer, {
    ...metadata,
    contentType: payload.content_type ?? payload.contentType ?? dataUrlMatch?.[1],
    deviceId: payload.device_id ?? payload.deviceId ?? metadata.deviceId,
    capturedAt: payload.captured_at ?? payload.capturedAt ?? metadata.capturedAt,
  });
}

export function metadataPathFor(filename) {
  return path.join(config.images.storageDir, `${filename}.json`);
}

export async function listSavedImages() {
  await ensureImageStorage();
  const entries = await fs.readdir(config.images.storageDir, { withFileTypes: true });
  const images = [];

  for (const entry of entries) {
    if (!entry.isFile() || !safeImageFilename(entry.name)) {
      continue;
    }

    const metadataPath = metadataPathFor(entry.name);
    let metadata = null;

    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    } catch {
      metadata = { filename: entry.name };
    }

    images.push(metadata);
  }

  return images.sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)));
}
