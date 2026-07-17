import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let supabase = null;
let storageBucketReady = false;
const imageUploadCache = new Map();

function normalizeTagId(value) {
  if (value === null || value === undefined) return null;
  const tagId = String(value).trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  return tagId.length ? tagId : null;
}

if (config.supabase.url && config.supabase.serviceKey) {
  supabase = createClient(config.supabase.url, config.supabase.serviceKey);
} else {
  console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Supabase logging is disabled.');
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;

  return {
    contentType: match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function isWebUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function storageErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return 'Unknown Supabase Storage error';
}

function extensionForContentType(contentType) {
  switch (contentType) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/bmp': return 'bmp';
    case 'image/jpeg':
    case 'image/jpg':
    default:
      return 'jpg';
  }
}

function safeStorageSegment(value, fallback) {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

async function ensureStorageBucket() {
  if (!supabase || storageBucketReady) return;

  const bucket = config.supabase.imageBucket;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  const existingBucket = buckets?.find((item) => item.name === bucket);
  if (!existingBucket) {
    const { error } = await supabase.storage.createBucket(bucket, {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'],
      fileSizeLimit: config.images.maxBytes,
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  } else if (!existingBucket.public) {
    throw new Error(`Supabase Storage bucket "${bucket}" must be public to create log image links.`);
  }

  storageBucketReady = true;
}

async function uploadImageToStorage({ deviceId, imagePath, metadata, folder = 'events' }) {
  if (!supabase) return null;
  const safeFolder = safeStorageSegment(folder, 'events');
  const cacheKey = `${safeFolder}:${imagePath}`;
  if (imageUploadCache.has(cacheKey)) return imageUploadCache.get(cacheKey);

  const parsed = parseDataUrl(imagePath);
  if (!parsed || parsed.buffer.length === 0) return null;

  await ensureStorageBucket();

  const extension = extensionForContentType(parsed.contentType);
  const now = new Date();
  const safeDeviceId = safeStorageSegment(deviceId || config.mqtt.deviceId, 'device');
  const objectPath = [
    safeFolder,
    safeDeviceId,
    now.toISOString().slice(0, 10),
    `${now.toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.${extension}`,
  ].join('/');

  const { error } = await supabase.storage
    .from(config.supabase.imageBucket)
    .upload(objectPath, parsed.buffer, {
      contentType: parsed.contentType,
      upsert: false,
      metadata: metadata || {},
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from(config.supabase.imageBucket)
    .getPublicUrl(objectPath);

  if (!data?.publicUrl) {
    throw new Error(`Supabase Storage did not return a public URL for ${objectPath}`);
  }

  const result = {
    bucket: config.supabase.imageBucket,
    path: objectPath,
    publicUrl: data.publicUrl,
    contentType: parsed.contentType,
    bytes: parsed.buffer.length,
  };
  imageUploadCache.set(cacheKey, result);
  console.log(`[Supabase] Image uploaded: ${result.bucket}/${result.path}`);
  return result;
}

export const supabaseService = {
  async prepareImageReference({ deviceId, imagePath, telegramMsgLink, metadata, folder = 'events' }) {
    if (!imagePath) {
      return {
        thumbnailUrl: telegramMsgLink || null,
        telegramMsgLink,
        imageMetadata: metadata || {},
      };
    }

    if (isWebUrl(imagePath)) {
      return {
        thumbnailUrl: imagePath,
        telegramMsgLink,
        imageMetadata: {
          ...(metadata || {}),
          image_storage_mode: metadata?.image_storage_mode || 'linked_url',
        },
      };
    }

    if (!supabase) {
      console.error('[Supabase] Event image was not stored because Supabase is not configured.');
      return {
        thumbnailUrl: telegramMsgLink || null,
        telegramMsgLink,
        imageMetadata: {
          ...(metadata || {}),
          image_storage_mode: telegramMsgLink ? 'telegram_link' : 'storage_unavailable',
        },
      };
    }

    try {
      const storedImage = await uploadImageToStorage({ deviceId, imagePath, metadata, folder });
      if (storedImage) {
        return {
          thumbnailUrl: storedImage.publicUrl,
          telegramMsgLink,
          imageMetadata: {
            ...(metadata || {}),
            image_storage_mode: 'supabase_storage',
            image_bucket: storedImage.bucket,
            image_path: storedImage.path,
            image_content_type: storedImage.contentType,
            image_bytes: storedImage.bytes,
          },
        };
      }
    } catch (error) {
      console.error('[Supabase] Error uploading image to storage:', error);
      return {
        thumbnailUrl: telegramMsgLink || null,
        telegramMsgLink,
        imageMetadata: {
          ...(metadata || {}),
          image_storage_mode: telegramMsgLink ? 'telegram_link' : 'storage_failed',
          image_storage_error: storageErrorMessage(error),
        },
      };
    }

    console.error('[Supabase] Event image was not stored because the payload was not a supported data URL.');
    return {
      thumbnailUrl: telegramMsgLink || null,
      telegramMsgLink,
      imageMetadata: {
        ...(metadata || {}),
        image_storage_mode: telegramMsgLink ? 'telegram_link' : 'invalid_image_payload',
      },
    };
  },

  async recordStoredImageReference({ deviceId, imageReference, metadata = {} }) {
    if (!supabase) throw new Error('Supabase is not configured.');
    const imageMetadata = imageReference?.imageMetadata || {};
    if (imageMetadata.image_storage_mode !== 'supabase_storage') {
      throw new Error('A Supabase Storage image reference is required.');
    }

    const { data, error } = await supabase
      .from('event_images')
      .insert([{
        device_id: deviceId,
        storage_mode: 'supabase_storage',
        storage_bucket: imageMetadata.image_bucket,
        storage_path: imageMetadata.image_path,
        public_url: imageReference.thumbnailUrl,
        mime_type: imageMetadata.image_content_type,
        image_size_bytes: imageMetadata.image_bytes,
        metadata,
      }])
      .select()
      .single();

    if (error) {
      await supabase.storage
        .from(imageMetadata.image_bucket)
        .remove([imageMetadata.image_path]);
      throw new Error(`Cannot link Storage image in event_images: ${error.message}`);
    }
    return data;
  },

  async insertAiLog({ deviceId, label, confidence, anomalyScore, objectCount, imagePath, telegramMsgLink, metadata }) {
    if (!supabase) return;

    const normalizedConfidence = Number(confidence);
    const normalizedAnomalyScore = Number(anomalyScore ?? confidence);
    const image = await this.prepareImageReference({
      deviceId,
      imagePath,
      telegramMsgLink,
      metadata,
      folder: 'ai-logs',
    });

    const { error } = await supabase.from('ai_logs').insert([
      {
        device_id: deviceId,
        label: label || 'model_inference',
        confidence: Number.isFinite(normalizedConfidence) ? normalizedConfidence : null,
        anomaly_score: Number.isFinite(normalizedAnomalyScore) ? normalizedAnomalyScore : null,
        object_count: Number.isFinite(Number(objectCount)) ? Number(objectCount) : 0,
        image_path: image.thumbnailUrl,
        image_bucket: image.imageMetadata.image_bucket || null,
        image_object_path: image.imageMetadata.image_path || null,
        image_mime_type: image.imageMetadata.image_content_type || null,
        image_bytes: image.imageMetadata.image_bytes || null,
        telegram_msg_link: image.telegramMsgLink,
        metadata: image.imageMetadata,
      },
    ]);

    if (error) {
      console.error('[Supabase] Error inserting AI log:', error);
      await this.insertAlert({
        deviceId,
        alertType: label || 'model_inference',
        message: `Suy luận AI: ${label || 'không xác định'} (${Math.round(Number(confidence || 0) * 100)}%)`,
        thumbnailUrl: image.thumbnailUrl,
        source: 'ai',
        severity: this.severityForAlertType(label || 'model_inference'),
        telegramMsgLink: image.telegramMsgLink,
        metadata: image.imageMetadata,
      });
    }
  },

  severityForAlertType(alertType) {
    if (['stranger_detected', 'camera_blocked', 'access_denied', 'rfid_invalid'].includes(alertType)) {
      return 'danger';
    }
    if (['object_left', 'motion', 'door_open'].includes(alertType)) {
      return 'warning';
    }
    return 'info';
  },

  sourceForAlertType(alertType) {
    if (['person_detected', 'stranger_detected', 'camera_blocked', 'object_detected', 'object_left', 'unknown_object', 'model_inference'].includes(alertType)) {
      return 'ai';
    }
    if (['access_granted', 'access_denied', 'rfid_invalid', 'rfid_scan', 'rfid_added', 'rfid_deleted'].includes(alertType)) {
      return 'rfid';
    }
    if (['motion', 'door_open'].includes(alertType)) {
      return 'mqtt';
    }
    return 'system';
  },

  async insertAlert({ deviceId, alertType, message, thumbnailUrl, severity, source, metadata, telegramMsgLink, resolved = false }) {
    if (!supabase) return;
    const image = await this.prepareImageReference({
      deviceId,
      imagePath: thumbnailUrl,
      telegramMsgLink,
      metadata,
      folder: 'events',
    });

    const { error } = await supabase.from('alerts').insert([
      {
        device_id: deviceId,
        alert_type: alertType,
        message,
        thumbnail_url: image.thumbnailUrl,
        image_bucket: image.imageMetadata.image_bucket || null,
        image_path: image.imageMetadata.image_path || null,
        image_mime_type: image.imageMetadata.image_content_type || null,
        image_bytes: image.imageMetadata.image_bytes || null,
        severity: severity || this.severityForAlertType(alertType),
        source: source || this.sourceForAlertType(alertType),
        metadata: image.imageMetadata,
        telegram_msg_link: image.telegramMsgLink,
        resolved,
      },
    ]);

    if (error) {
      console.error('[Supabase] Error inserting alert:', error);
    }
  },

  async getDeviceSettings(deviceId) {
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('device_settings')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (error) {
      console.error('[Supabase] Error loading device settings:', error);
      return null;
    }

    return data;
  },

  async getDeviceAccessConfig(deviceId, maxCards = 32) {
    if (!supabase) return null;

    const [settingsResult, cardsResult] = await Promise.all([
      supabase
        .from('device_settings')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle(),
      supabase
        .from('rfid_credentials')
        .select('tag_id')
        .eq('device_id', deviceId)
        .eq('is_active', true)
        .order('added_at', { ascending: true })
        .limit(maxCards),
    ]);

    if (settingsResult.error || cardsResult.error) {
      console.error(
        '[Supabase] Error loading device access config:',
        settingsResult.error || cardsResult.error
      );
      return null;
    }

    return {
      settings: settingsResult.data || {},
      rfidAllowlist: (cardsResult.data || [])
        .map((card) => normalizeTagId(card.tag_id))
        .filter(Boolean),
    };
  },

  async recordPendingRfidScan({ deviceId, tagId, thumbnailUrl, metadata = {} }) {
    if (!supabase) return null;
    const normalizedTagId = normalizeTagId(tagId);
    if (!normalizedTagId) return null;

    const { data, error } = await supabase.rpc('record_pending_rfid_scan', {
      p_device_id: deviceId,
      p_tag_id: normalizedTagId,
    });

    if (error) {
      console.error('[Supabase] Error recording pending RFID:', error);
      return null;
    }

    await this.insertAlert({
      deviceId,
      alertType: 'rfid_scan',
      message: `Thẻ RFID/NFC mới chờ duyệt: ${tagId}`,
      thumbnailUrl,
      severity: 'warning',
      source: 'rfid',
      metadata: { ...metadata, tag_id: normalizedTagId, raw_tag_id: tagId, pending_id: data },
      resolved: false,
    });

    return data;
  },

  async recordRfidAccessGranted({ deviceId, tagId, reason = 'test_allow_all' }) {
    if (!supabase) return { ok: true, reason: 'supabase_disabled' };
    const normalizedTagId = normalizeTagId(tagId);
    if (!normalizedTagId) return { ok: false, reason: 'invalid_tag' };

    const { data: credential, error: credentialError } = await supabase
      .from('rfid_credentials')
      .select('id,name')
      .eq('device_id', deviceId)
      .eq('tag_id', normalizedTagId)
      .maybeSingle();

    if (credentialError) {
      console.error('[Supabase] Error loading RFID credential:', credentialError);
    }

    if (credential?.id) {
      const { error: updateError } = await supabase
        .from('rfid_credentials')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', credential.id);

      if (updateError) {
        console.error('[Supabase] Error updating RFID last_used_at:', updateError);
      }
    }

    const { error } = await supabase.from('access_logs').insert([{
      device_id: deviceId,
      tag_id: normalizedTagId,
      credential_id: credential?.id || null,
      decision: 'granted',
      reason,
    }]);

    if (error) {
      console.error('[Supabase] Error inserting RFID access log:', error);
      return { ok: false, reason: 'database_error' };
    }

    return {
      ok: true,
      credentialId: credential?.id,
      holderName: credential?.name,
      reason,
    };
  },

  async validateRfid(tagId) {
    if (!supabase) return { ok: false, reason: 'supabase_disabled' };
    const normalizedTagId = normalizeTagId(tagId);
    if (!normalizedTagId) return { ok: false, reason: 'invalid_tag' };

    const deviceId = config.mqtt.deviceId;
    const { data, error } = await supabase.rpc('validate_rfid_access', {
      p_device_id: deviceId,
      p_tag_id: normalizedTagId,
    });

    if (error) {
      console.error('[Supabase] Error validating RFID:', error);
      return { ok: false, reason: 'database_error' };
    }

    const result = Array.isArray(data) ? data[0] : data;
    return {
      ok: result?.ok === true,
      credentialId: result?.credential_id,
      holderName: result?.holder_name,
      reason: result?.reason || 'unknown_tag',
    };
  }
};
