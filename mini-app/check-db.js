import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const tablesToCheck = ['device_settings', 'settings', 'device_config', 'alert_config'];
  for (const table of tablesToCheck) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (!error) {
      console.log(`Found table: ${table}`, data);
    } else {
      console.log(`Table ${table} not found or error:`, error.message);
    }
  }
}
check();
