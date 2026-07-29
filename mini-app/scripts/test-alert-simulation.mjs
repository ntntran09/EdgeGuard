import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

console.log('=====================================================');
console.log('🤖 EdgeGuard Alert Simulator (Giả lập thông báo từ thiết bị)');
console.log('=====================================================\n');

const PORT = process.env.PORT || 4000;
const SERVER_URL = `http://localhost:${PORT}`;
const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';
const TOPIC = `/EdgeGuard/${DEVICE_ID}/telemetry/vision-alert`;

async function runSimulation() {
  // Tạo ảnh mẫu JPEG hợp lệ bằng sharp (200x200 màu đỏ)
  const imageBuffer = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 3,
      background: { r: 217, g: 83, b: 79 },
    },
  }).jpeg().toBuffer();

  const sampleImageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  const alertPayload = {
    alert_type: 'stranger_detected', // Hỗ trợ: stranger_detected | camera_blocked | object_left
    confidence: 0.98,
    event_id: Math.floor(Date.now() / 1000),
    image_base64: sampleImageBase64,
    uptime_ms: Date.now(),
    people_count: 1,
    label: 'Stranger Detected (Phát hiện người lạ)'
  };

  console.log(`📡 Đang gửi dữ liệu giả lập tới Server: ${SERVER_URL}/api/mqtt/send`);
  console.log(`📌 Topic: ${TOPIC}`);
  console.log(`⚠️ Alert Type: ${alertPayload.alert_type} (${alertPayload.label})\n`);

  try {
    const res = await fetch(`${SERVER_URL}/api/mqtt/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: TOPIC,
        message: alertPayload,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      console.log('✅ Gửi dữ liệu giả lập THÀNH CÔNG!');
      console.log('-----------------------------------------------------');
      console.log('🎉 TOÀN BỘ LUỒNG ĐÃ ĐƯỢC KÍCH HOẠT:');
      console.log(' 1. Server lưu alert vào Supabase DB');
      console.log(' 2. Server kích hoạt gửi ảnh & tin nhắn qua Telegram Bot');
      console.log(' 3. Server kích hoạt gửi Email cảnh báo qua Nodemailer');
      console.log('-----------------------------------------------------');
      console.log('👉 Hãy kiểm tra ngay Telegram Chat ID & Hòm thư Email của bạn!');
    } else {
      console.error('❌ Server trả về lỗi:', data);
    }
  } catch (err) {
    console.error('❌ Không thể kết nối tới Server!');
    console.error(`Chi tiết lỗi: ${err.message}`);
    console.log('\n💡 Gợi ý: Bạn đã bật Server chưa? Hãy chạy `npm run dev` hoặc `node server.js` ở thư mục mini-app trước khi chạy script này!');
  }
}

runSimulation();
