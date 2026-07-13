# MQTT cho thiết bị EdgeGuard

Mặc định `{base}` là `/EdgeGuard/device_001`. Thiết bị subscribe `{base}/command/#` và publish với QoS 0.

## Buzzer

Publish lệnh tới `{base}/command/buzzer`:

```json
{"enabled":true,"frequency_hz":2000,"duration_ms":500}
```

Hoặc dùng envelope của backend:

```json
{"source":"web","payload":{"enabled":true,"frequency_hz":2500,"duration_ms":1000}}
```

- `enabled`: bật/tắt; mặc định `true`.
- `frequency_hz`: 100–10000 Hz; mặc định 2000. Có tác dụng với passive buzzer; active buzzer chỉ bật/tắt.
- `duration_ms`: 0–10000 ms; mặc định 500. Gửi `enabled:false` hoặc `duration_ms:0` để dừng ngay.

## Servo

Publish tới `{base}/command/servo`:

```json
{"angle":90}
```

Hoặc `{"payload":{"angle":90}}`. `angle` được giới hạn trong 0–180 độ. Góc khởi động là 0 và có thể đổi bằng `SERVO_START_ANGLE` trong `config.h`.

## PN532

PN532 đọc thẻ ISO14443A liên tục và publish `{base}/telemetry/nfc`:

```json
{
  "uid":"04A1B2C3D4E5F6",
  "uid_length":7,
  "technology":"ISO14443A",
  "read_at_ms":123456
}
```

`uid` là chuỗi hex viết hoa, không có dấu phân cách. Cùng một UID được chống lặp trong 1.5 giây. Firmware chỉ gửi UID/loại thẻ, không đọc hoặc publish nội dung block của thẻ.

## Camera

Cứ 10 giây firmware publish một JPEG binary trực tiếp tới `{base}/image`. Payload không phải JSON/base64; subscriber phải nhận buffer nhị phân và lưu với MIME `image/jpeg`. Backend EdgeGuard hiện tại đã hỗ trợ topic này.

## Trạng thái và hệ thống

- `{base}/status`: retained `online`; Last Will là retained `offline`.
- `{base}/telemetry/system`: JSON mỗi 10 giây gồm `uptime_ms`, `rssi_dbm`, `free_heap`, `psram_free`.

Ví dụ dùng Mosquitto CLI:

```bash
mosquitto_pub -h broker.hivemq.com -t /EdgeGuard/device_001/command/servo -m '{"angle":90}'
mosquitto_pub -h broker.hivemq.com -t /EdgeGuard/device_001/command/buzzer -m '{"frequency_hz":2000,"duration_ms":500}'
mosquitto_sub -h broker.hivemq.com -t '/EdgeGuard/device_001/telemetry/#' -v
```
