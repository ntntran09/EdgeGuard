# Edge Impulse Presence Evaluator

Ứng dụng Next.js dùng để đánh giá kết quả FOMO Model Testing từ Edge Impulse theo metric presence. Web lấy dữ liệu thật từ project Edge Impulse do người dùng cấu hình, tự chấm lại TP, FP, FN, TN và không fallback sang dữ liệu giả khi API lỗi.

## Bản final

Bản dùng để nộp/chấm nằm ở route:

```text
/no-exact-match
```

Route `/` vẫn giữ bản giao diện cũ để đối chiếu khi cần. Bản final đã bỏ metric `Exact-match` khỏi phần metric tổng và báo cáo export, nhưng vẫn giữ các thống kê:

- `Tổng số ảnh`
- `Ảnh PASS`
- `Ảnh FAIL`

## Metric tổng

Bản final hiển thị bốn chỉ số chính:

- `Macro F1`
- `Micro F1`
- `Micro Precision`
- `Micro Recall`

Mỗi chỉ số có dấu `?` trên giao diện. Khi trỏ chuột hoặc focus vào dấu `?`, web hiển thị định nghĩa/công thức tính.

### Công thức

`Micro Precision`:

```text
Tổng TP / (Tổng TP + Tổng FP)
```

Chỉ số này cho biết trong các prediction được tính là positive, có bao nhiêu prediction đúng.

`Micro Recall`:

```text
Tổng TP / (Tổng TP + Tổng FN)
```

Chỉ số này cho biết trong các ground truth cần tìm, có bao nhiêu object được phát hiện đúng.

`Micro F1`:

```text
2 * Micro Precision * Micro Recall / (Micro Precision + Micro Recall)
```

Nhóm quy ước `Micro F1` là chỉ số chính để báo cáo độ chính xác của mô hình FOMO vì chỉ số này gộp TP, FP, FN trên toàn bộ class và cân bằng giữa Precision với Recall.

`Macro F1`:

```text
Trung bình F1 của từng class
```

Với mỗi class:

```text
F1 = 2 * Precision * Recall / (Precision + Recall)
```

Nếu mẫu số bằng `0`, chỉ số tương ứng hiển thị `N/A`. Khi tính Macro F1, web bỏ qua các giá trị `N/A`.

## Logic tính điểm

Edge Impulse cung cấp ground truth bbox, prediction bbox, class và confidence score. Web tự chấm lại TP, FP, FN, TN theo logic bên dưới, không lấy trực tiếp từ Edge Impulse.

`Ảnh chỉ có human`: có ít nhất một prediction `human` đúng class, đủ threshold và centroid nằm trong bbox `human` thì `PASS`. Dự đoán dư class khác không làm ảnh sai.

`Ảnh chỉ có object package/backpack`: có ít nhất một object đúng class, đủ threshold và centroid nằm trong bbox object thì `PASS`. Nếu dư `human` thì `FAIL`.

`Ảnh có cả human và object`: chỉ cần `human` đúng class, đủ threshold và centroid nằm trong bbox `human` thì `PASS`. Object được bỏ qua theo đặc tả.

Centroid và bounding box trong phần visual chỉ phục vụ quan sát/debug, không thay đổi dữ liệu gốc từ Edge Impulse.

## Cấu hình được phép thay đổi

Người dùng chỉ cấu hình ba giá trị trên giao diện:

- `Project ID`: số Project ID của Edge Impulse.
- `API Key`: Edge Impulse Project API Key.
- `Confidence Threshold`: giá trị từ `0` đến `1`, mặc định `0.50`.

Các giá trị sau được cố định trong source code:

```ts
impulseId = 1;
modelVariant = "int8";
humanLabel = "human";
objectLabels = ["package", "backpack"];
```

Ba class duy nhất được custom metric hỗ trợ:

```text
human
package
backpack
```

Project mới phải dùng đúng ba tên class trên. Web không tự map `person`, `parcel`, `bag` hoặc nhãn khác sang ba class này.

## Confidence Threshold

Prediction được tính khi:

```text
prediction.score >= confidenceThreshold
```

Score đúng bằng threshold vẫn được tính.

Nút `Tối ưu` tìm threshold global có `Macro F1` tốt nhất trên dữ liệu hiện tại. Nút `0.50` đưa threshold về mặc định. Khi người dùng kéo slider hoặc nhập threshold mới, web tính lại metric từ prediction và confidence score đã tải.

## Dữ liệu và label không hỗ trợ

Ứng dụng giữ dữ liệu Edge Impulse gốc trong `predictions` và chỉ lọc theo threshold khi chấm metric. Web không sinh thêm prediction, không sửa label, confidence score, bounding box, ground truth hoặc sample.

Nếu ground truth chứa label ngoài `human`, `package`, `backpack`, sample bị đánh dấu `UNSUPPORTED_LABEL`, đưa vào nhóm `SKIPPED_UNSUPPORTED_LABEL` và không tính vào metric tổng.

Nếu prediction chứa label không hỗ trợ, prediction đó bị bỏ qua khi chấm metric và sample có warning `UNSUPPORTED_PREDICTION_IGNORED`.

## Ảnh và visual

Thumbnail/sample image được proxy qua:

```text
GET /api/images/[sampleId]
```

Route ảnh có cache server ngắn hạn để giảm delay khi mở lại ảnh đã xem. Khi mở dialog kết quả từng ảnh, web preload ảnh hiện tại, hai ảnh trước và hai ảnh sau để thao tác next/previous mượt hơn.

Trong dialog có ba chế độ xem:

- `So sánh`: Ground Truth và Prediction đặt cạnh nhau.
- `Overlay`: Ground Truth và Prediction chồng lên cùng ảnh.
- `Ảnh gốc`: chỉ xem ảnh, không vẽ box.

Nút `Xem classification` mở Edge Impulse Studio theo Project ID hiện tại.

## Export

Bản final có các file export:

```text
presence_overall_metrics.csv  presence_class_metrics.csv  presence_details.csv  presence_report.json  presence_report.html  thresholds.json
```

Các export của bản final không chứa `Exact-match` và không chứa API key.

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

## API nội bộ

Các route chính:

```text
POST   /api/session/config
GET    /api/session/config
DELETE /api/session/config
GET    /api/evaluation
POST   /api/evaluation/refresh
GET    /api/images/[sampleId]
GET    /api/export/html
```

Các route evaluation và image lấy Project ID, API key và Confidence Threshold từ session. Impulse ID `1`, model variant `int8`, human label `human`, object labels `package` và `backpack` luôn lấy từ constants nội bộ, không nhận từ frontend.

## Khi Edge Impulse API lỗi

Ứng dụng hiển thị lỗi rõ ràng, ví dụ không thể tải dữ liệu Model Testing từ Edge Impulse. Ứng dụng không thay thế bằng dữ liệu mô phỏng.

## Chạy local

Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run dev -- --port 3000
```

Bash hoặc terminal khác:

```bash
npm install
npm run dev -- --port 3000
```

Mở bản final:

```text
http://localhost:3000/no-exact-match
```

Mở bản cũ để đối chiếu:

```text
http://localhost:3000
```

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Windows PowerShell:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Bộ test kiểm tra fixed config, URL động theo Project ID, Impulse ID `1`, model variant `int8`, scoring chỉ nhận `human`, chỉ xem `package` và `backpack` là object, không alias `person`/`parcel`/`bag`, threshold inclusive, unsupported label diagnostics, session-safe frontend response behavior qua redaction utilities, export bản final không chứa `Exact-match`, và dữ liệu prediction gốc không bị sửa trong quá trình normalize/evaluate.
