import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seed() {
  console.log('Seeding data...');
  const deviceId = process.env.MQTT_DEVICE_ID || 'device_001';

  // Seed AI Logs
  const aiLogs = [
    {
      device_id: deviceId,
      label: 'stranger_detected',
      confidence: 0.92,
      image_path: 'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=400&q=80'
    },
    {
      device_id: deviceId,
      label: 'object_left',
      confidence: 0.85,
      image_path: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=400&q=80'
    }
  ];

  for (const log of aiLogs) {
    const { error } = await supabase.from('ai_logs').insert([log]);
    if (error) console.error('Error inserting AI log:', error.message);
    else console.log('Inserted AI log:', log.label);
  }

  // Seed Alerts
  const alerts = [
    {
      device_id: deviceId,
      alert_type: 'access_granted',
      message: 'Nguyễn Văn A đã mở cửa',
      resolved: true
    },
    {
      device_id: deviceId,
      alert_type: 'access_denied',
      message: 'Thẻ chưa được đăng ký (UID: FA:8B:12:44)',
      resolved: false
    }
  ];

  for (const alert of alerts) {
    const { error } = await supabase.from('alerts').insert([alert]);
    if (error) console.error('Error inserting alert:', error.message);
    else console.log('Inserted alert:', alert.alert_type);
  }

  // Ensure default device settings
  const { error: settingsError } = await supabase.from('device_settings').upsert({
    device_id: deviceId,
    object_left_max_seconds: 60,
    stranger_alert_enabled: false,
    camera_blocked_alert_enabled: true
  }, { onConflict: 'device_id' });

  if (settingsError) console.error('Error inserting settings:', settingsError.message);
  else console.log('Inserted/Updated default device settings');

  console.log('Seed complete!');
}

seed();
