#!/usr/bin/env node
/**
 * Script: clear-today-logs.mjs
 * Xóa toàn bộ ai_logs và alerts của hôm nay để reset lại trạng thái test sạch.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../backend/config.js';

const sb = createClient(config.supabase.url, config.supabase.serviceKey);
const DEVICE_ID = config.mqtt.deviceId;

// Mốc thời gian đầu ngày hôm nay (UTC)
const todayStart = new Date();
todayStart.setUTCHours(0, 0, 0, 0);
const since = todayStart.toISOString();

console.log(`\n🧹 Dọn dẹp logs từ ${since} trở đi cho device: ${DEVICE_ID}\n`);

// Xóa ai_logs hôm nay
const { data: aiDel, error: aiErr } = await sb
  .from('ai_logs')
  .delete()
  .eq('device_id', DEVICE_ID)
  .gte('created_at', since)
  .select('id');

if (aiErr) {
  console.error('❌ Lỗi xóa ai_logs:', aiErr.message);
} else {
  console.log(`✅ Đã xóa ${aiDel?.length || 0} ai_logs`);
}

// Xóa alerts hôm nay
const { data: evDel, error: evErr } = await sb
  .from('alerts')
  .delete()
  .eq('device_id', DEVICE_ID)
  .gte('created_at', since)
  .select('id');

if (evErr) {
  console.error('❌ Lỗi xóa alerts:', evErr.message);
} else {
  console.log(`✅ Đã xóa ${evDel?.length || 0} alerts`);
}

console.log('\n🎉 Xong! Giờ chạy test script để thấy đúng 2 logs mới.\n');
