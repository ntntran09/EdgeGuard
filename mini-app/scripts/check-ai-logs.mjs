import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data, error } = await supabase.from('ai_logs').select('label, confidence, metadata').order('created_at', { ascending: false }).limit(2);
console.log(JSON.stringify(data, null, 2));
