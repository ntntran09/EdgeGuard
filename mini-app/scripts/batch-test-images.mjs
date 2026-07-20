#!/usr/bin/env node
/**
 * Script: batch-test-images.mjs
 * Chạy lần lượt từng ảnh trong folder, mỗi ảnh gửi qua luồng MQTT
 * (image/json → model/inference) giống hệt ESP32 thật.
 * 
 * Usage: node scripts/batch-test-images.mjs [folder_path]
 */

import mqtt from 'mqtt';
import fs from 'fs';
import path from 'path';
import { config, mqttUrl } from '../backend/config.js';

const topicBase = config.mqtt.topicBase;
const brokerUrl = mqttUrl();

const folderArg = process.argv[2] || '/Users/apple/Downloads/Demo AWS/2026-07-20';

// Lấy toàn bộ file .jpg/.png trong folder
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const files = fs.readdirSync(folderArg)
  .filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
  .sort()
  .map(f => path.join(folderArg, f));

if (files.length === 0) {
  console.error(`❌ Không tìm thấy ảnh trong: ${folderArg}`);
  process.exit(1);
}

// Delay giữa các ảnh (ms) — cần > AI_LOG_COOLDOWN (8s) + rekognition cooldown (10s)
// Đặt 12s để chắc chắn mỗi ảnh sinh 1 ai_log + 1 alert độc lập
const DELAY_MS = 12000;

console.log(`\n🎬 Batch Test: ${files.length} ảnh trong ${folderArg}`);
console.log(`⏱  Delay giữa các ảnh: ${DELAY_MS / 1000}s\n`);

const imageTopic = `${topicBase}/image/json`;
const fomoTopic  = `${topicBase}/model/inference`;

const client = mqtt.connect(brokerUrl, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  clean: true,
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendFrame(imagePath, index) {
  const buffer = fs.readFileSync(imagePath);
  const base64Data = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  const filename = path.basename(imagePath);

  console.log(`📷 [${index + 1}/${files.length}] ${filename}`);

  // 1. Gửi frame ảnh
  client.publish(imageTopic, JSON.stringify({
    image_base64: base64Data,
    capturedAt: new Date().toISOString(),
    width: 320,
    height: 240,
  }), { qos: 0 });

  // Đợi server lưu frame vào RAM
  await sleep(1500);

  // 2. Gửi tín hiệu FOMO phát hiện người
  client.publish(fomoTopic, JSON.stringify({
    label: 'person',
    confidence: 0.94,
    people_count: 1,
    anomaly_score: 0.05,
    uptime_ms: Date.now(),
    input_width: 320,
    input_height: 240,
    detections: [
      {
        label: 'person',
        type: 'person',
        confidence: 0.94,
        x: 20,
        y: 20,
        width: 280,
        height: 200,
        centroid_x: 160,
        centroid_y: 120,
      },
    ],
  }), { qos: 0 });

  console.log(`   ✅ Đã gửi — đợi ${DELAY_MS / 1000}s trước ảnh tiếp theo...`);
}

client.on('connect', async () => {
  console.log(`✅ Kết nối MQTT: ${brokerUrl}\n`);

  for (let i = 0; i < files.length; i++) {
    await sendFrame(files[i], i);
    if (i < files.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n🎉 Hoàn thành! Đã gửi ${files.length} ảnh.`);
  console.log(`   F5 Mini-App để xem ${files.length * 2} logs mới.\n`);

  client.end();
  process.exit(0);
});

client.on('error', (err) => {
  console.error(`❌ Lỗi MQTT:`, err);
  process.exit(1);
});
