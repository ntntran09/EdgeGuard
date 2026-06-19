import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let supabase = null;

if (config.supabase.url && config.supabase.serviceKey) {
  supabase = createClient(config.supabase.url, config.supabase.serviceKey);
} else {
  console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Supabase logging is disabled.');
}

export const supabaseService = {
  async insertAiLog({ deviceId, label, confidence, imagePath, telegramMsgLink }) {
    if (!supabase) return;

    const { error } = await supabase.from('ai_logs').insert([
      {
        device_id: deviceId,
        label,
        confidence,
        image_path: imagePath,
        telegram_msg_link: telegramMsgLink,
      },
    ]);

    if (error) {
      console.error('[Supabase] Error inserting AI log:', error);
    }
  },

  async insertAlert({ deviceId, alertType, message }) {
    if (!supabase) return;

    const { error } = await supabase.from('alerts').insert([
      {
        device_id: deviceId,
        alert_type: alertType,
        message,
        resolved: false,
      },
    ]);

    if (error) {
      console.error('[Supabase] Error inserting alert:', error);
    }
  },

  async validateRfid(tagId) {
    if (!supabase) return false;

    const { data, error } = await supabase
      .from('rfid_credentials')
      .select('id, is_active')
      .eq('tag_id', tagId)
      .single();

    if (error || !data) {
      return false;
    }

    return data.is_active === true;
  }
};
