import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let supabase = null;

if (config.supabase.url && config.supabase.serviceKey) {
  supabase = createClient(config.supabase.url, config.supabase.serviceKey);
} else {
  console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Supabase logging is disabled.');
}

export const supabaseService = {
  async prepareImageReference({ deviceId, imagePath, telegramMsgLink, metadata }) {
    if (!supabase || !imagePath) {
      return { thumbnailUrl: telegramMsgLink || imagePath, telegramMsgLink, imageMetadata: metadata || {} };
    }

    if (telegramMsgLink) {
      return {
        thumbnailUrl: telegramMsgLink,
        telegramMsgLink,
        imageMetadata: { ...(metadata || {}), image_storage_mode: 'telegram_link' },
      };
    }

    const { data, error } = await supabase
      .from('event_images')
      .insert([{
        device_id: deviceId,
        storage_mode: 'database',
        image_base64: imagePath,
        telegram_msg_link: telegramMsgLink,
        metadata: metadata || {},
      }])
      .select('id')
      .single();

    if (error) {
      console.error('[Supabase] Error storing image in database:', error);
      return {
        thumbnailUrl: imagePath,
        telegramMsgLink,
        imageMetadata: { ...(metadata || {}), image_storage_mode: 'database_failed' },
      };
    }

    return {
      thumbnailUrl: imagePath,
      telegramMsgLink,
      imageMetadata: { ...(metadata || {}), image_storage_mode: 'database', image_id: data.id },
    };
  },

  async insertAiLog({ deviceId, label, confidence, anomalyScore, objectCount, imagePath, telegramMsgLink, metadata }) {
    if (!supabase) return;

    const normalizedConfidence = Number(confidence);
    const normalizedAnomalyScore = Number(anomalyScore ?? confidence);
    const image = await this.prepareImageReference({ deviceId, imagePath, telegramMsgLink, metadata });

    const { error } = await supabase.from('ai_logs').insert([
      {
        device_id: deviceId,
        label: label || 'model_inference',
        confidence: Number.isFinite(normalizedConfidence) ? normalizedConfidence : null,
        anomaly_score: Number.isFinite(normalizedAnomalyScore) ? normalizedAnomalyScore : null,
        object_count: Number.isFinite(Number(objectCount)) ? Number(objectCount) : 0,
        image_path: image.thumbnailUrl,
        telegram_msg_link: image.telegramMsgLink,
        metadata: image.imageMetadata,
      },
    ]);

    if (error) {
      console.error('[Supabase] Error inserting AI log:', error);
      await this.insertAlert({
        deviceId,
        alertType: label || 'model_inference',
        message: `AI inference: ${label || 'unknown'} (${Math.round(Number(confidence || 0) * 100)}%)`,
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
    const image = await this.prepareImageReference({ deviceId, imagePath: thumbnailUrl, telegramMsgLink, metadata });

    const { error } = await supabase.from('alerts').insert([
      {
        device_id: deviceId,
        alert_type: alertType,
        message,
        thumbnail_url: image.thumbnailUrl,
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

  async recordPendingRfidScan({ deviceId, tagId, thumbnailUrl }) {
    if (!supabase) return null;

    const { data, error } = await supabase.rpc('record_pending_rfid_scan', {
      p_device_id: deviceId,
      p_tag_id: tagId,
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
      metadata: { tag_id: tagId, pending_id: data },
      resolved: false,
    });

    return data;
  },

  async validateRfid(tagId) {
    if (!supabase) return { ok: false, reason: 'supabase_disabled' };

    const deviceId = config.mqtt.deviceId;
    const { data, error } = await supabase.rpc('validate_rfid_access', {
      p_device_id: deviceId,
      p_tag_id: tagId,
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
