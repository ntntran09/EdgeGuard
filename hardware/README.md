# EdgeGuard ESP32-CAM hardware

Firmware này chạy trên **AI Thinker ESP32-CAM** và điều khiển bốn ngoại vi: buzzer, PN532 I2C, servo và camera. Chi tiết topic/payload MQTT nằm trong [MQTT-PERIPHERALS.md](MQTT-PERIPHERALS.md).

## Đấu dây

| Thiết bị | Chân thiết bị | ESP32-CAM |
|---|---|---|
| PN532 (chọn I2C bằng DIP switch) | SDA | GPIO13 |
| PN532 | SCL | GPIO14 |
| PN532 | VCC | 3.3V |
| PN532 | GND | GND |
| Servo SG90 | PWM | GPIO12 |
| Buzzer | Signal | GPIO15 |

Servo phải dùng nguồn 5V riêng đủ dòng (khuyến nghị từ 1 A), nhưng bắt buộc nối chung GND với ESP32-CAM. Không cấp servo từ chân 3.3V. Buzzer công suất lớn cần transistor và điện trở bảo vệ; không kéo trực tiếp quá dòng cho phép của GPIO.

GPIO12 và GPIO15 là chân strapping và GPIO13/14/15 cũng là bus microSD. Không lắp/thao tác thẻ microSD khi dùng cấu hình này. Nếu board không boot, ngắt servo/buzzer trong lúc reset hoặc thêm mạch đệm để ngoại vi không ép mức logic sai lúc khởi động.

## Thư viện Arduino

Cài bằng Library Manager hoặc ZIP tương ứng:

- `PubSubClient` (Nick O'Leary)
- `ArduinoJson` 6.x hoặc 7.x
- `ESP32Servo`
- `PN532` của Seeed Studio/Elechouse, có các header `PN532.h` và `PN532_I2C.h`

`esp_camera`, `WiFi` và `Wire` có sẵn trong ESP32 Arduino core.

## Build và upload

1. Sửa Wi-Fi, broker, device ID và base topic trong `EdgeGuardDevice/config.h`.
2. Arduino IDE: chọn **AI Thinker ESP32-CAM**, bật PSRAM, Partition Scheme có app đủ lớn.
3. Nối GPIO0 xuống GND để upload; sau khi upload tháo GPIO0 khỏi GND rồi reset.
4. Mở Serial Monitor ở 115200 baud để kiểm tra camera, PN532, Wi-Fi và MQTT.

Camera chụp JPEG VGA (có PSRAM) hoặc QVGA (không có PSRAM) và gửi mỗi 10 giây. Public broker mặc định chỉ phù hợp thử nghiệm.
