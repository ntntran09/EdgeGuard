import 'server-only';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const IMAGE_BUCKET = process.env.SUPABASE_IMAGE_BUCKET || 'event-images';
const DEFAULT_MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 5 * 1024 * 1024);
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpe?g|webp|gif|bmp));base64,([a-zA-Z0-9+/=\r\n]+)$/i;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

function safeStorageSegment(value: string, fallback: string) {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

export interface StoredImageReference {
  url: string;
  bucket: string;
  path: string;
  contentType: string;
  bytes: number;
}

export async function uploadDataUrlToStorage({
  dataUrl,
  folder,
  deviceId,
  metadata = {},
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
}: {
  dataUrl: string;
  folder: string;
  deviceId: string;
  metadata?: Record<string, string>;
  maxBytes?: number;
}): Promise<StoredImageReference> {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured');

  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) throw new Error('Image must be a PNG, JPG, WebP, GIF or BMP data URL');

  const matchedContentType = match[1].toLowerCase();
  const contentType = matchedContentType === 'image/jpg' ? 'image/jpeg' : matchedContentType;
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) throw new Error('Image payload is empty');
  if (buffer.length > maxBytes) throw new Error(`Image exceeds ${maxBytes} bytes`);

  const safeFolder = safeStorageSegment(folder, 'uploads');
  const safeDeviceId = safeStorageSegment(deviceId, 'device');
  const extension = EXTENSIONS[contentType] || 'jpg';
  const objectPath = `${safeFolder}/${safeDeviceId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(objectPath, buffer, {
      contentType,
      upsert: false,
      metadata,
    });
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(objectPath);
  if (!data?.publicUrl) {
    await supabase.storage.from(IMAGE_BUCKET).remove([objectPath]);
    throw new Error('Supabase Storage did not return a public URL');
  }

  return {
    url: data.publicUrl,
    bucket: IMAGE_BUCKET,
    path: objectPath,
    contentType,
    bytes: buffer.length,
  };
}

export async function removeStorageObject(bucket: string | null | undefined, objectPath: string | null | undefined) {
  if (!isSupabaseConfigured || !bucket || !objectPath) return;
  const { error } = await supabase.storage.from(bucket).remove([objectPath]);
  if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`);
}
