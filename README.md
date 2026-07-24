# Edge Impulse Presence Evaluator

Ứng dụng Next.js dùng để đánh giá FOMO Model Testing từ Edge Impulse theo metric presence. Dữ liệu được lấy trực tiếp từ project Edge Impulse do người dùng cấu hình; ứng dụng không có Mock Mode và không fallback sang dữ liệu giả khi API lỗi.

## Cấu hình được phép thay đổi

Người dùng chỉ cấu hình ba giá trị:

- `Project ID`: nhập số Project ID của Edge Impulse trên giao diện.
- `API Key`: nhập Edge Impulse Project API Key trong ô password.
- `Confidence Threshold`: giá trị từ `0` đến `1`, mặc định `0.5`.

Các nút chính trên giao diện:

- `Kết nối project`
- `Đổi project`
- `Xóa cấu hình`
- `Làm mới dữ liệu`

Không có form hoặc cấu hình cho Impulse ID, model variant, human label, object labels, class mapping hoặc Mock Mode.

## Cấu hình cố định

Các giá trị sau được cố định trong source code:

```ts
impulseId = 1;
modelVariant = "int8";
humanLabel = "human";
objectLabels = ["package", "backpack"];
```

Ba class duy nhất được custom metric hỗ trợ là:

```text
human
package
backpack
```

Không thể thay đổi, thêm, xóa hoặc map lại class. Project mới phải dùng đúng ba tên class trên. Các nhãn như `person`, `parcel`, `bag` không được tự động chuyển thành `human`, `package`, `backpack`.

## Cách sử dụng

1. Mở website.
2. Nhập Project ID, ví dụ `1066469`.
3. Nhập Edge Impulse Project API Key.
4. Điều chỉnh Confidence Threshold nếu cần.
5. Bấm `Kết nối project`.
6. Backend kiểm tra project và tải dữ liệu Model Testing thật từ Edge Impulse.
7. Website tính metric với ba class cố định.
8. Dùng `Làm mới dữ liệu` để tải lại từ Edge Impulse.
9. Dùng `Đổi project` để xóa session/cache hiện tại và nhập Project ID/API key khác.
10. Dùng `Xóa cấu hình` để xóa API key khỏi server memory và đưa giao diện về trạng thái cấu hình.

Không cần sửa source code hoặc restart web để đổi project.

## API key và session

API key không được hardcode và không được lưu trong source code, Git, URL, Local Storage, Session Storage, frontend log, backend log, error message hoặc biến môi trường `NEXT_PUBLIC_*`.

Frontend gửi cấu hình đến:

```http
POST /api/session/config
```

Backend validate request bằng Zod strict, kiểm tra Edge Impulse, tạo session ID ngẫu nhiên, lưu API key tạm trong server memory và trả cookie `HttpOnly`, `SameSite=Strict`, `Secure` trong production. Cookie chỉ chứa session ID, không chứa API key.

Frontend có thể đọc cấu hình an toàn qua:

```http
GET /api/session/config
```

Response không bao giờ chứa API key, chỉ có `hasApiKey: true`, Project ID, threshold và các giá trị cố định.

API key bị xóa khi người dùng xóa cấu hình, đổi project, session hết hạn hoặc server restart.

## Confidence Threshold

Threshold mặc định là `0.5` và hợp lệ khi:

```ts
0 <= confidenceThreshold && confidenceThreshold <= 1
```

Prediction được tính khi:

```ts
prediction.score >= confidenceThreshold
```

Score đúng bằng threshold vẫn được tính. Khi thay đổi threshold, ứng dụng tính lại summary, bảng, chart và danh sách sample từ prediction đã tải; không cần tải lại ảnh hoặc gọi lại API nếu dữ liệu đã có. Việc giảm threshold không thể khôi phục prediction không có trong payload Model Testing mà Edge Impulse trả về.

## Dữ liệu và nhãn không hỗ trợ

Ứng dụng giữ dữ liệu Edge Impulse gốc trong `predictions` và chỉ tạo dữ liệu lọc theo threshold khi chấm metric. Không sinh thêm prediction, không sửa label, confidence score, bounding box, ground truth hoặc sample.

Nếu ground truth chứa label ngoài `human`, `package`, `backpack`, sample bị đánh dấu `UNSUPPORTED_LABEL`, đưa vào nhóm `SKIPPED_UNSUPPORTED_LABEL` và không tính vào tổng metric.

Nếu prediction chứa label không hỗ trợ, prediction đó bị bỏ qua khi chấm metric và sample có warning `UNSUPPORTED_PREDICTION_IGNORED`.

## API nội bộ

Các route chính:

```text
POST   /api/session/config
GET    /api/session/config
DELETE /api/session/config
GET    /api/evaluation
POST   /api/evaluation/refresh
GET    /api/images/[sampleId]
```

Các route evaluation và image lấy Project ID, API key và Confidence Threshold từ session. Impulse ID `1`, model variant `int8`, human label `human`, object labels `package` và `backpack` luôn lấy từ constants nội bộ, không nhận từ frontend.

Thumbnail được proxy qua `/api/images/[sampleId]`. Nút `Xem classification` mở URL Edge Impulse Studio theo Project ID hiện tại, không copy ảnh vào project và không dùng ảnh mock.

## Khi Edge Impulse API lỗi

Ứng dụng hiển thị lỗi rõ ràng, ví dụ không thể tải dữ liệu Model Testing từ Edge Impulse. Ứng dụng không thay thế bằng dữ liệu mô phỏng.

## Chạy local

```bash
npm install
npm run dev
```

Windows PowerShell có thể dùng:

```powershell
npm.cmd install
npm.cmd run dev
```

Mở `http://localhost:3000`.

## Kiểm tra

```bash
npm run lint
npx tsc --noEmit --incremental false
npm run test
```

Bộ test kiểm tra fixed config, URL động theo Project ID, Impulse ID `1`, model variant `int8`, scoring chỉ nhận `human`, chỉ xem `package` và `backpack` là object, không alias `person`/`parcel`/`bag`, threshold inclusive, unsupported label diagnostics, session-safe frontend response behavior qua redaction utilities, và dữ liệu prediction gốc không bị sửa trong quá trình normalize/evaluate.
