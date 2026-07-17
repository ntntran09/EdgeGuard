# EdgeGuard Database Schema Documentation

Tài liệu này mô tả chi tiết kiến trúc Cơ sở dữ liệu (Database Schema) của dự án **EdgeGuard**, được triển khai trên nền tảng **Supabase (PostgreSQL)**. 

Hệ thống được thiết kế theo hướng **Sự kiện (Event-Driven)**, hỗ trợ đa thiết bị (Multi-node), tối ưu cho IoT và khả năng tích hợp linh hoạt với trí tuệ nhân tạo (AWS Rekognition).

---

## 1. Cấu trúc các bảng (Tables)

| Tên Bảng (Table) | Mục đích chính | Vai trò trong hệ thống |
| :--- | :--- | :--- |
| **`device_settings`** | Bảng trung tâm (Root) | Quản lý cấu hình của từng thiết bị biên (Edge Device). Mọi dữ liệu log/ảnh đều phải thuộc về 1 thiết bị ở đây. |
| **`rfid_credentials`** | Phân quyền truy cập | Lưu danh sách các Thẻ từ (RFID/NFC) hợp lệ và phân quyền (owner, admin, resident, guest). |
| **`known_faces`** | CSDL Khuôn mặt (FaceID) | Lưu trữ hồ sơ người dùng để so khớp với kết quả từ AWS Rekognition. Được trói buộc vào thẻ RFID để cấp quyền. |
| **`alerts`** | Cảnh báo An ninh | Ghi nhận các sự kiện khẩn cấp: Có trộm, cạy cửa, quét thẻ sai, phát hiện chuyển động... |
| **`ai_logs`** | Nhật ký Suy luận AI | Ghi nhận kết quả nhận diện từ Camera (AWS trả về ai, độ tự tin bao nhiêu %,...). |
| **`access_logs`** | Lịch sử Đóng/Mở cửa | Ghi lại toàn bộ lịch sử quẹt thẻ (Được phép vào hay Bị từ chối). |
| **`pending_rfid_scans`** | Hàng chờ duyệt Thẻ | Lưu các mã thẻ lạ (chưa đăng ký) quẹt vào cửa để Admin duyệt thêm nhanh từ xa. |
| **`telegram_device_users`**| Danh sách nhận thông báo | Khai báo những tài khoản Telegram nào sẽ nhận được tin nhắn báo động từ cửa nào. |
| **`event_images`** | Quản lý File Ảnh | Lưu trữ đường dẫn (URL) của các ảnh chụp từ Camera (Lưu trên Supabase Storage). |
| **`security_event_views`** | Trạng thái Đã xem | Đánh dấu người dùng Telegram nào đã xem cảnh báo nào (Read receipt). |

---

## 2. Bảng Tổng kết Ràng buộc (Database Constraints)

Hệ thống sử dụng các khóa (Keys) nghiêm ngặt để đảm bảo **Không rác dữ liệu** và **Không trùng lặp**:

| Bảng (Table) | Loại Khóa | Cột liên quan | Mục đích (Làm gì?) | Tại sao cần? (Lợi ích) |
| :--- | :--- | :--- | :--- | :--- |
| **Tất cả 9 bảng phụ** (alerts, ai_logs, known_faces, rfid_credentials...) | **Khóa Ngoại** (Foreign Key) | Cột `device_id` trỏ về bảng `device_settings` | Ràng buộc mọi dữ liệu (log, ảnh, thẻ...) vào 1 thiết bị gốc. | **Dọn rác tự động:** Nếu bạn xóa 1 thiết bị, toàn bộ dữ liệu liên quan của thiết bị đó ở 9 bảng kia sẽ tự động bị xóa theo (`ON DELETE CASCADE`). |
| **known_faces** | **Khóa Ngoại** (Foreign Key) | Cột `credential_id` trỏ về `rfid_credentials` | Trói buộc "Khuôn mặt" của 1 người vào "Thẻ RFID" của họ. | **Mở khóa bằng khuôn mặt (FaceID):** Giúp hệ thống biết khuôn mặt này thuộc về nhân viên nào, từ đó kích hoạt lệnh mở cửa. |
| **known_faces** | **Khóa Duy Nhất** (Unique Key) | Cột `rekognition_face_id` | Chốt ID của AWS Rekognition trả về là độc nhất. | **Chống trùng lặp AWS:** Đảm bảo 1 khuôn mặt AI phân tích ra không bị lưu đè thành 2 người khác nhau trong Database. |
| **rfid_credentials** | **Khóa Duy Nhất Kép** (Composite Unique) | `(device_id, tag_id)` | Mỗi thẻ từ (tag) chỉ xuất hiện 1 lần trên 1 cửa. | **Chống rác RFID:** Chặn người dùng lỡ tay bấm Add 1 cái thẻ vào cùng 1 cái cửa tận 2 lần. |
| **telegram_device_users** | **Khóa Duy Nhất Kép** (Composite Unique) | `(device_id, telegram_id)` | Mỗi tài khoản Telegram chỉ xuất hiện 1 lần trên 1 cửa. | **Chống Spam tin nhắn:** Chặn việc Add 1 user 2 lần, tránh lỗi Bot Telegram gửi 2 tin nhắn cảnh báo y hệt nhau cùng lúc. |
| **security_event_views** | **Khóa Duy Nhất Kép** (Composite Unique) | `(device_id, telegram_id, event_id)` | Lưu trạng thái "Đã xem tin nhắn" (Read receipt). | **Đồng bộ hóa UI:** Đảm bảo mỗi người chỉ có 1 trạng thái Đã Xem cho 1 sự kiện. Không bị lưu dư thừa. |

---

## 3. Luồng Tích hợp AI (AWS Rekognition)

EdgeGuard đã được tách (Decouple) phần lõi AI nặng nề sang cho AWS xử lý, giúp Database nội bộ nhẹ bén:
1. Khi có người đứng trước Camera, ảnh được tải lên **Supabase Storage** (`event-images` bucket).
2. Backend Python đẩy ảnh qua **AWS Rekognition**.
3. AWS phân tích ra khuôn mặt và trả về mã ID độc nhất (`FaceId`).
4. Backend lấy `FaceId` này dò vào cột `rekognition_face_id` (Khóa Unique) của bảng `known_faces` trong Supabase để lấy ra tên thật (`display_name`).
5. Nếu nhận diện thành công, Backend đẩy kết quả vào bảng `ai_logs` với `confidence` (0-1). Từ `ai_logs`, thông qua VIEW `security_events`, App sẽ hiển thị Cảnh báo lên màn hình người dùng.
