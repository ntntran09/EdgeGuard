import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { createInternalApiKey, INTERNAL_API_KEY_HEADER } from '../shared/telegram-auth.js';
import { config } from '../backend/config.js';

console.log('=====================================================');
console.log('📷 EdgeGuard Camera Frame Simulator (Giả lập luồng Camera)');
console.log('=====================================================\n');

const PORT = process.env.PORT || 4000;
const SERVER_URL = `http://localhost:${PORT}`;
const DEVICE_ID = config.mqtt.deviceId || 'device_001';
const TOPIC = `/EdgeGuard/${DEVICE_ID}/telemetry/vision-alert`;

// Lấy đường dẫn ảnh từ tham số truyền vào
const customImagePath = process.argv[2];

async function getImageBase64() {
  if (customImagePath) {
    const resolvedPath = path.resolve(customImagePath);
    if (fs.existsSync(resolvedPath)) {
      console.log(`🖼️ Đang nạp file ảnh của bạn: ${resolvedPath}`);
      const buffer = fs.readFileSync(resolvedPath);
      // Chuyển ảnh thành JPEG chuẩn 640x480 qua sharp
      const jpegBuffer = await sharp(buffer)
        .resize(640, 480, { fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer();
      return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    } else {
      console.warn(`⚠️ Không tìm thấy file tại "${resolvedPath}". Sử dụng ảnh giả lập mặc định.`);
    }
  }

  console.log('🖼️ Đang tạo ảnh giả lập khung hình Camera (640x480)...');
  const svgText = `
    <svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#1a1d24"/>
      <circle cx="320" cy="200" r="80" fill="#d9534f" opacity="0.8"/>
      <text x="320" y="210" font-family="Arial" font-size="28" fill="#ffffff" text-anchor="middle" font-weight="bold">STRANGER</text>
      <text x="320" y="340" font-family="Arial" font-size="20" fill="#4caf50" text-anchor="middle">EDGEGUARD SECURITY CAMERA</text>
      <text x="320" y="380" font-family="Arial" font-size="16" fill="#aaaaaa" text-anchor="middle">${new Date().toLocaleString('vi-VN')}</text>
    </svg>
  `;
  const imageBuffer = await sharp(Buffer.from(svgText)).jpeg().toBuffer();
  return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
}

async function runCameraSimulation() {
  const sampleImageBase64 = await getImageBase64();
  const eventId = Math.floor(Date.now() / 1000);
  const internalKey = createInternalApiKey(config.telegram.botToken);

  console.log(`\n📡 Đang gửi luồng giả lập Camera đầy đủ tới Server: ${SERVER_URL}/api/mqtt/send`);

  // 1. Gửi Khung hình live camera (/image/json)
  const imageTopic = `/EdgeGuard/${DEVICE_ID}/image/json`;
  const imagePayload = {
    image_base64: sampleImageBase64,
    content_type: 'image/jpeg',
    device_id: DEVICE_ID,
    captured_at: new Date().toISOString(),
  };

  // 2. Gửi AI Inference log (/model/inference) -> lưu ai_logs trong DB
  const aiTopic = `/EdgeGuard/${DEVICE_ID}/model/inference`;
  const aiPayload = {
    event_id: eventId,
    label: 'Person Detected (Phát hiện người lạ)',
    confidence: 0.95,
    people_count: 2,
    anomaly_score: 0.88,
    image_base64: sampleImageBase64,
    uptime_ms: Date.now(),
  };

  // 3. Gửi Cảnh báo thị giác (/telemetry/vision-alert) -> lưu alerts & gửi Telegram / Email
  const alertTopic = `/EdgeGuard/${DEVICE_ID}/telemetry/vision-alert`;
  const alertPayload = {
    alert_type: 'stranger_detected',
    confidence: 0.98,
    event_id: eventId,
    image_base64: sampleImageBase64,
    uptime_ms: Date.now(),
    people_count: 2,
    label: 'Stranger Detected (Phát hiện người lạ)'
  };

  async function postMqtt(topic, message) {
    const res = await fetch(`${SERVER_URL}/api/mqtt/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_API_KEY_HEADER]: internalKey,
      },
      body: JSON.stringify({ topic, message }),
    });
    return res.json();
  }

  try {
    console.log(` 1️⃣ Gửi Live Frame -> ${imageTopic}`);
    await postMqtt(imageTopic, imagePayload);

    console.log(` 2️⃣ Gửi AI Inference Log -> ${aiTopic}`);
    await postMqtt(aiTopic, aiPayload);

    console.log(` 3️⃣ Gửi Vision Alert -> ${alertTopic}`);
    const alertRes = await postMqtt(alertTopic, alertPayload);

    if (alertRes && alertRes.ok) {
      console.log('\n✅ ĐÃ GIẢ LẬP TOÀN BỘ LUỒNG CAMERA THÀNH CÔNG!');
      console.log('-----------------------------------------------------');
      console.log('🎉 KẾT QUẢ TRÊN HỆ THỐNG:');
      console.log(' 1. Live Frame đã cập nhật trên Dashboard (Camera View)');
      console.log(' 2. Nhật ký AI Log đã ghi vào Supabase DB & Storage');
      console.log(' 3. Cảnh báo đã ghi vào Supabase DB & Storage');
      console.log(' 4. Tin nhắn kèm bức ảnh đã phát tới Telegram Bot');
      console.log(' 5. Email kèm bức ảnh đã gửi tới hòm thư người dùng!');
      console.log('-----------------------------------------------------');
    } else {
      console.error('❌ Server trả về lỗi:', alertRes);
    }
  } catch (err) {
    console.error('❌ Không thể kết nối tới Server!');
    console.error(`Chi tiết lỗi: ${err.message}`);
    console.log('\n💡 Gợi ý: Hãy đảm bảo bạn đã chạy `npm run dev` ở thư mục mini-app!');
  }
}

runCameraSimulation();
