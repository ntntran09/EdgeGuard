import mqtt from 'mqtt';
import fs from 'fs';
import { config, mqttUrl } from '../backend/config.js';

const topicBase = config.mqtt.topicBase;
const brokerUrl = mqttUrl();

// Parse command line argument or default to /Users/apple/Downloads/TM.jpg
const imageArg = process.argv[2] || '/Users/apple/Downloads/TM.jpg';

async function runTest() {
  console.log(`\n======================================================`);
  console.log(`🚀 TEST LUỒNG 2: Camera → AWS Rekognition → Supabase`);
  console.log(`======================================================\n`);

  let base64Data = null;

  if (imageArg.startsWith('http://') || imageArg.startsWith('https://')) {
    console.log(`📡 Đang tải ảnh từ URL: ${imageArg}`);
    const res = await fetch(imageArg);
    const buffer = Buffer.from(await res.arrayBuffer());
    base64Data = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } else if (fs.existsSync(imageArg)) {
    console.log(`📂 Đang đọc file ảnh: ${imageArg}`);
    const buffer = fs.readFileSync(imageArg);
    base64Data = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } else {
    console.log(`⚠️ Không tìm thấy file ${imageArg}. Đang dùng ảnh giả lập pixel trống...`);
    base64Data = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  }

  console.log(`🔗 Đang kết nối MQTT Broker: ${brokerUrl}`);
  const client = mqtt.connect(brokerUrl, {
    username: config.mqtt.username,
    password: config.mqtt.password,
    clean: true,
  });

  client.on('connect', async () => {
    console.log(`✅ Kết nối MQTT thành công!`);

    const imageTopic = `${topicBase}/image/json`;
    const fomoTopic = `${topicBase}/model/inference`;

    // Bước 1: Gửi frame ảnh lên server (server lưu vào RAM để dùng khi AI trigger)
    console.log(`\n📷 [1/2] Publish frame ảnh lên: ${imageTopic}`);
    const imagePayload = JSON.stringify({
      image_base64: base64Data,
      capturedAt: new Date().toISOString(),
      width: 320,
      height: 240,
    });
    client.publish(imageTopic, imagePayload, { qos: 0 });

    // Đợi để server kịp nhận và lưu frame vào bộ nhớ (phải đủ dài hơn timeout fetch ESP32)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Bước 2: Gửi tín hiệu FOMO phát hiện người → server sẽ lấy frame vừa gửi
    //          để gọi AWS Rekognition → nhận diện khuôn mặt → ghi log vào Supabase
    console.log(`🧠 [2/2] Publish tín hiệu phát hiện người lên: ${fomoTopic}`);
    const fomoPayload = JSON.stringify({
      label: 'person',
      confidence: 0.94,
      people_count: 1,
      anomaly_score: 0.05,
      uptime_ms: 123456,
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
        },
      ],
    });
    client.publish(fomoTopic, fomoPayload, { qos: 0 });

    console.log(`\n✅ Đã gửi xong! Backend sẽ tự động:`);
    console.log(`   1. Lấy frame ảnh từ bộ nhớ`);
    console.log(`   2. Gọi AWS Rekognition để nhận diện khuôn mặt`);
    console.log(`   3. Ghi kết quả (người quen / người lạ) vào Supabase`);
    console.log(`   4. Hiển thị log trên Mini-App\n`);

    setTimeout(() => {
      client.end();
      process.exit(0);
    }, 1500);
  });

  client.on('error', (err) => {
    console.error(`❌ Lỗi MQTT:`, err);
    process.exit(1);
  });
}

runTest();
