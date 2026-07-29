# EdgeGuard - Toàn bộ luồng hệ thống

Tài liệu này mô tả trạng thái **thực tế theo code hiện tại** của ba thành phần:

- `hardware/EdgeGuardDevice`: firmware ESP32 chính.
- `mini-app/backend`: Express backend, HTTP-first device transport, MQTT bootstrap/fallback, camera proxy và xử lý AI/RFID.
- `mini-app/src`: Telegram Mini App và Next.js API.

Ngoài luồng chính, tài liệu cũng ghi riêng `hardware/CameraCapture` và AI worker MQTT cũ để tránh nhầm chung với kiến trúc đang chạy.

## Ký hiệu

| Ký hiệu | Ý nghĩa |
|---|---|
| `[NEW]` | Use case hoặc branch mới trong working tree hiện tại so với `HEAD` |
| `[LEGACY]` | Vẫn còn code hỗ trợ nhưng không phải đường chính |
| `[GAP]` | Có cấu hình/code một phía nhưng luồng end-to-end chưa hoàn chỉnh |
| Retained | MQTT broker giữ message cuối để client reconnect nhận lại |

## 1. Sơ đồ tổng quan

```mermaid
flowchart LR
    U[Telegram user / Admin] --> APP[Telegram Mini App]
    APP -->|HTTPS /api/*| NEXT[Next.js API]
    NEXT -->|HTTP| BE[Express backend]

    BE <-->|MQTT bootstrap + fallback| MQ[MQTT broker]
    DEV[ESP32 EdgeGuardDevice] <-->|MQTT LWT/endpoints/bootstrap/fallback| MQ
    DEV -->|HTTP POST telemetry/RFID/FOMO/vision| BE
    BE -->|HTTP POST command/config + GET camera| DEV

    NEXT <-->|settings, users, cards, event views| SB[(Supabase DB)]
    BE <-->|events, AI logs, RFID validation| SB
    BE -->|event image| ST[(Supabase Storage)]
    BE <-->|face search| AWS[AWS Rekognition]
    NEXT <-->|known-face index/delete| AWS

    AI[AI MQTT worker] -.->|telemetry subscribe| MQ
    AI -.->|model/inference - GAP| MQ
    CAM[Standalone CameraCapture] -.->|direct HTTPS upload| ST
    CAM -.->|direct REST insert| SB
```

Đường chính device-server là kết hợp của hai transport:

| Chiều | Transport | Dữ liệu |
|---|---|---|
| Device -> Server | HTTP | telemetry system/security/nfc, RFID scan, FOMO inference, vision alert |
| Device -> Server | MQTT | retained status/LWT, retained camera endpoint discovery, telemetry/FOMO/vision fallback, ảnh legacy |
| Server -> Device | HTTP POST | config, servo, alarm, buzzer, reboot, vision result |
| Server -> Device | MQTT | retained bootstrap backend/FOMO URL, command/config fallback |
| Server -> Device | HTTP GET | live stream, capture hiện tại, exact event frame |

## 2. Danh sách use case

| ID | Use case | Actor chính | Trạng thái |
|---|---|---|---|
| UC-01 | Khởi động, Wi-Fi/MQTT bootstrap và HTTP transport | Device, backend | Đang dùng; có `[NEW]` |
| UC-02 | Discovery camera và đồng bộ config HTTP-first | Device, backend, Supabase | Đang dùng; có `[NEW]` |
| UC-03 | Telemetry HTTP-first, status và tạo event cảm biến | Device, backend | Đang dùng; có `[NEW]` |
| UC-04 | Xem camera live và fallback frame | User, app, backend, device | Đang dùng; có `[NEW]` |
| UC-05 | Mở/khóa cửa từ xa và auto-lock | User, app, device | Đang dùng |
| UC-06 | Bật/tắt alarm, buzzer, reboot, command dev | User/dev, backend, device | Đang dùng |
| UC-07 | Quét RFID online/offline | Device, backend, Supabase | Đang dùng |
| UC-08 | Thêm/sửa/xóa/duyệt thẻ RFID | Admin, app, backend, device | Đang dùng |
| UC-09 | FOMO, exact frame và Rekognition | Device, backend, AWS | Đang dùng; có `[NEW]` |
| UC-10 | Stranger/object-left/camera-blocked alert | Device, backend | Đang dùng; có `[NEW]` |
| UC-11 | Quản lý khuôn mặt quen | Admin, app, Storage, AWS | Đang dùng |
| UC-12 | Dashboard, lịch sử, đánh dấu đã xem | User, app, backend | Đang dùng |
| UC-13 | Phân quyền và quản lý Telegram user | Admin, app, Supabase | Đang dùng, có lưu ý |
| UC-14 | CameraCapture độc lập | Người dùng, camera, Supabase | Luồng riêng |
| UC-15 | Ảnh MQTT và AI MQTT worker | Device/worker, broker | `[LEGACY]` / `[GAP]` |
| UC-16 | API vận hành, test ảnh và manual event | Operator/dev, backend | Hỗ trợ dev; có `[GAP]` |

## 3. UC-01 - Khởi động và kết nối device-server

```mermaid
sequenceDiagram
    autonumber
    participant D as ESP32 Device
    participant M as MQTT Broker
    participant B as Express Backend
    participant DB as Supabase

    D->>D: Init camera, actuator, NVS config, PN532, FOMO
    D->>D: Khóa cửa ở startup

    loop Cho đến khi Wi-Fi kết nối
        D->>D: WiFi.begin()
        alt Kết nối thất bại
            D->>D: Chờ 10 giây, disconnect và thử lại
        else Kết nối thành công
            D->>D: Nhận IP LAN, bật camera HTTP
        end
    end

    par Backend kết nối broker
        B->>M: CONNECT, reconnect mỗi 1 giây nếu mất kết nối
        M-->>B: CONNACK
        B->>M: SUB status, telemetry/*, image topics
    and Device kết nối broker
        D->>M: CONNECT + retained LWT status=offline
        alt MQTT thất bại
            D->>D: Chờ 5 giây rồi thử lại
        else MQTT thành công
            M-->>D: CONNACK
            D->>M: SUB command/#
            D->>M: PUB retained status=online
        end
    end

    D->>M: PUB retained telemetry/endpoints
    M-->>B: telemetry/endpoints
    B->>DB: Đọc settings + RFID allowlist
    alt Đọc DB thành công
        B->>D: POST :82/api/config config đầy đủ
        B->>M: PUB retained command/config chỉ gồm backend_url + fomo_inference_url
    else DB không sẵn sàng
        B->>M: PUB retained command/config chỉ gồm backend URL
    end
    alt HTTP config thất bại
        B->>M: PUB retained command/config đầy đủ làm fallback
        M-->>D: command/config
    end
    D->>D: Validate, apply và persist NVS

    alt Device rời mạng bất thường
        M-->>B: LWT retained status=offline
        D->>D: Dừng camera HTTP, retry Wi-Fi/MQTT
    else Backend rời broker
        B->>B: connected=false, tự reconnect
    end
```

Branch chi tiết:

| Điều kiện | Xử lý |
|---|---|
| Camera init lỗi | Firmware retry theo `CAMERA_INIT_RETRY_MS` |
| Camera capture lỗi liên tiếp | Deinit, khởi động lại camera |
| HTTP telemetry lỗi | Firmware thử MQTT fallback nếu broker còn kết nối |
| MQTT JSON/packet quá lớn | Không publish fallback, ghi log lỗi |
| Config có `backend_url`/URL FOMO không hợp lệ | Device bỏ qua URL đó |
| Mở NVS thất bại | Config vẫn áp dụng trong RAM, không persist được |
| Mất Wi-Fi | Camera server dừng; endpoint sẽ publish lại sau reconnect |

## 4. UC-02 - Discovery camera và đồng bộ config

```mermaid
flowchart TD
    A[Device có Wi-Fi + camera ready] --> B[Start HTTP servers]
    B --> C[Port 82: capture, event-frame, health]
    B --> D[Port 81: MJPEG stream]
    C --> E{MQTT connected?}
    D --> E
    E -- No --> F[Đánh dấu endpoint chưa publish]
    F --> E
    E -- Yes --> G[PUB retained telemetry/endpoints]
    G --> H[Backend validate http/https URL]
    H --> I[Cập nhật cameraEndpoints snapshot]
    I --> J[Backend tính LAN backend URL cùng subnet device]
    J --> K{Đọc settings + allowlist được?}
    K -- Yes --> L[Build config đầy đủ]
    K -- No --> M[Chỉ build backend_url + fomo_inference_url]
    L --> N[POST :82/api/config]
    M --> N2[PUB retained command/config bootstrap URL]
    N --> O{HTTP config OK?}
    O -- Yes --> P[Device apply config]
    O -- No --> Q[PUB retained command/config đầy đủ fallback]
    Q --> P
    N2 --> P
    P --> R{Giá trị thay đổi?}
    R -- Yes --> S[Persist NVS]
    R -- No --> T[Không ghi lại NVS]
```

Config đầy đủ hiện đồng bộ xuống device:

| Field | Tác dụng trên device |
|---|---|
| `auto_lock_enabled`, `auto_lock_ms` | Lập lịch khóa lại sau khi mở |
| `camera_publish_enabled` | Cho phép camera HTTP live |
| `ai_detection_enabled` | Bật/tắt FOMO inference |
| `camera_blocked_alert_enabled` | Bật/tắt publish alert camera bị che |
| `object_left_alert_enabled`, `stranger_alert_enabled` | Gate alert object-left/stranger tại firmware |
| `vision_stable_alert_ms` | Thời gian scene ổn định trước khi phát object/stranger alert |
| `backend_url`, `fomo_inference_url` | Địa chỉ HTTP device gửi inference |
| `lock_angle`, `unlock_angle` | Góc servo |
| `rfid_allowlist` | Cache tối đa 32 thẻ để mở offline |

`[NEW]` Port camera được tách: control ở `82`, MJPEG stream ở `81`. Mỗi khi backend nhận endpoint mới, backend đồng bộ lại `backend_url`/FOMO URL theo subnet của device. Retained MQTT config trong trạng thái bình thường chỉ giữ phần bootstrap network URL; full operational config chỉ retained khi HTTP delivery thất bại.

## 5. UC-03 - Telemetry và event cảm biến

```mermaid
flowchart TD
    A[Device tạo payload telemetry] --> B{HTTP backend_url khả dụng?}
    B -- Yes --> C[POST /api/device/telemetry channel + payload]
    C --> D{2xx?}
    D -- No --> E[Thử MQTT fallback]
    B -- No --> E
    E --> F{MQTT connected?}
    F -- Yes --> G[PUB telemetry topic tương ứng]
    F -- No --> H[Bỏ/lùi theo logic từng queue]
    D -- Yes --> I[Backend receiveTelemetry transport=http]
    G --> J[Backend receiveTelemetry transport=mqtt]
    I --> K{Channel/Topic}
    J --> K
    K -->|status qua MQTT| L[Cập nhật online/offline]
    K -->|system| M[Camera, PN532, heap, RSSI, FOMO/telemetry HTTP metrics, door]
    K -->|environment| M2[Cập nhật temperature và humidity]
    K -->|power| M3[Lưu raw snapshot]
    K -->|endpoints qua MQTT retained| N[Cập nhật URL camera + sync config]
    K -->|security| O[Cập nhật motion/door/distance]
    K -->|nfc| P[Chạy UC-07 RFID]
    K -->|visionAlert| Q[Chạy UC-10 vision alert]
    K -->|image / image/json| R[Cache live frame legacy]
    K -->|image/event/id| S[Cache exact frame legacy]

    O --> T{motion=true?}
    T -- Yes --> U[Capture frame nếu có + insert motion alert]
    T -- No --> V{door_open=true?}
    U --> V
    V -- Yes --> W[Capture frame nếu có + insert door_open alert]
    V -- No --> X[Chỉ cập nhật snapshot]
    W --> X
```

Backend expose snapshot qua `GET /api/device/status`; endpoint cũ `GET /api/mqtt/status` vẫn trả cùng snapshot cho tương thích. Next.js `GET /api/status` gọi `/api/device/status` và ghép snapshot này với `device_settings` để trả về dashboard.

`[GAP]` Backend có subscribe `telemetry/environment` và `telemetry/power`, nhưng firmware `EdgeGuardDevice` hiện không publish hai topic này. `power` cũng chưa có logic summarize riêng ngoài raw topic snapshot.

## 6. UC-04 - Xem camera live

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant A as Mini App
    participant N as Next.js API
    participant B as Express Backend
    participant D as ESP32 Camera

    U->>A: Mở dashboard
    A->>N: GET /api/status
    N->>B: GET /api/device/status
    B-->>N: Camera endpoints đã discovery
    N-->>A: streamProxyUrl + frameProxyUrl

    alt Có stream endpoint
        A->>B: GET /api/camera/stream
        B->>D: GET :81/stream
        alt MJPEG thành công
            D-->>B: multipart frames
            B-->>A: Proxy stream
        else Timeout, upstream lỗi, hoặc ảnh render lỗi
            A->>B: GET /api/camera/frame theo chu kỳ
            B->>D: GET :82/capture
            D-->>B: JPEG
            B-->>A: JPEG
        end
    else Device chưa announce endpoint
        B-->>A: 503
        A->>A: Hiện camera unavailable
    end

    opt Có fresh MQTT image legacy dưới 5 giây
        A->>B: GET /api/mqtt/stream
        B-->>A: Multipart từ frame cache
    end
```

Nhánh proxy frame trả về `502` nếu upstream không phải image/ảnh rỗng, `504` nếu timeout, và `503` nếu chưa có endpoint.

## 7. UC-05 - Mở/khóa cửa từ xa

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant N as Next.js /api/door
    participant DB as Supabase
    participant B as Express Backend
    participant M as MQTT Broker
    participant D as ESP32 Device

    U->>N: POST action=unlock hoặc lock
    alt action=unlock
        N->>DB: Đọc auto-lock settings
        alt DB lỗi/không cấu hình
            N->>N: Dùng mặc định 10 giây
        end
        N->>B: POST /api/device/command servo unlock
        B->>D: POST :82/api/command servo unlock
        alt HTTP command lỗi
            B->>M: PUB command/servo QoS 1 fallback
            M-->>D: command/servo
        end
        D->>D: Mở servo
        alt auto_lock_ms > 0
            D->>D: Hẹn giờ khóa lại
            D->>D: Hết giờ -> khóa cửa
        else Auto-lock tắt
            D->>D: Giữ trạng thái mở
        end
    else action=lock
        N->>B: POST command servo lock
        B->>D: POST :82/api/command servo lock
        D->>D: Khóa ngay
        alt HTTP command lỗi
            B->>M: PUB command/servo fallback
            M-->>D: Khóa ngay
        end
    end

    D->>B: POST /api/device/telemetry security door state
    alt HTTP telemetry lỗi
        D->>M: PUB telemetry/security fallback
    end
    N->>DB: Log door_unlocked hoặc door_locked nếu DB sẵn sàng

    alt Backend không gọi được HTTP device và MQTT fallback cũng lỗi
        N-->>U: 502 Cannot connect to device
    else Thành công
        N-->>U: ok + doorOpen + autoLockMs
    end
```

Lưu ý: API trả `transport=http` khi device HTTP nhận lệnh, hoặc `transport=mqtt` khi dùng fallback. Telemetry door state vẫn là xác nhận gián tiếp sau lệnh.

## 8. UC-06 - Alarm, buzzer, reboot và command

```mermaid
flowchart TD
    A[Mini App / Dev client] --> Z[POST /api/device/command hoặc /api/mqtt/command]
    Z --> Y{Device HTTP :82/api/command OK?}
    Y -- Yes --> B{Command}
    Y -- No --> X[PUB command topic MQTT fallback]
    X --> B
    B -->|alarm active=true| C[Device bật âm khẩn cấp đổi tần]
    B -->|alarm active=false| D[Device tắt alarm]
    B -->|buzzer| E{Alarm đang active?}
    E -- Yes --> F[Bỏ qua buzzer command]
    E -- No --> G[Phát tần số 100-10000 Hz, tối đa 10 giây]
    B -->|reboot| H[Delay 250 ms và ESP.restart]
    B -->|scan| I[Chỉ log: PN532 đã scan liên tục]
    B -->|command khác hợp lệ| J[Device nhận JSON nhưng không có handler]
    B -->|JSON lỗi| K[Device log và bỏ qua]
```

Alarm từ Mini App gọi `POST /api/device/command` và được log vào Supabase nếu DB sẵn sàng. Endpoint dev `POST /api/mqtt/command` vẫn còn cho tương thích nhưng cũng đi qua HTTP-first helper; `POST /api/mqtt/send` mới publish topic tùy ý trực tiếp.

## 9. UC-07 - Quét RFID online và offline

```mermaid
flowchart TD
    A[PN532 đọc UID] --> B[Normalize UID]
    B --> C{UID có trong NVS allowlist?}

    C -- Yes --> D[Mở cửa ngay tại device]
    D --> E{Auto-lock bật?}
    E -- Yes --> F[Hẹn khóa lại]
    E -- No --> G[Không hẹn khóa]
    F --> H{HTTP backend hoặc MQTT fallback khả dụng?}
    G --> H

    C -- No --> H
    H -- No --> I{Đã mở local?}
    I -- Yes --> J[Hoàn tất offline, server không có event]
    I -- No --> K[Từ chối offline, server không có event]

    H -- Yes --> L[POST /api/device/telemetry nfc với local_access_granted]
    L --> L2{HTTP accepted?}
    L2 -- No --> L3[PUB telemetry/nfc MQTT fallback]
    L2 -- Yes --> M[Backend validate UID trong Supabase]
    L3 --> M
    M --> N{Thẻ active và hợp lệ?}
    N -- Yes --> O{Device đã mở local?}
    O -- Yes --> P[Không gửi servo lần hai]
    O -- No --> Q[POST :82/api/command servo unlock; MQTT fallback nếu lỗi]
    P --> R[Log rfid_scan + access_granted]
    Q --> R

    N -- No --> S{master_key_enabled?}
    S -- Yes --> T[Capture frame + upsert pending_rfid_scan]
    S -- No --> U[Log rfid_scan + rfid_invalid]
```

Nếu `RFID_ALLOW_ALL=true`, backend coi mọi thẻ là hợp lệ trong chế độ test. Firmware vẫn chỉ mở local khi UID nằm trong allowlist; nếu chưa có, backend sẽ gửi servo command HTTP-first sau khi nhận scan.

## 10. UC-08 - Quản lý và duyệt thẻ RFID

```mermaid
flowchart TD
    A[Admin thao tác thẻ] --> B{Admin hợp lệ?}
    B -- No --> C[403 Admin only]
    B -- Yes --> D{Supabase configured?}
    D -- No --> E[503]
    D -- Yes --> F{master_key_enabled?}
    F -- No --> G[409: bật cấu hình RFID trước]
    F -- Yes --> H{Tác vụ}

    H -->|Thêm UID trực tiếp| I[Normalize + upsert credential active]
    H -->|Duyệt pending| J{Accept hay decline?}
    J -- Decline --> K[Mark declined + log]
    J -- Accept --> L[Upsert credential + mark accepted + log]
    H -->|Sửa tên| M[Update DB, không cần sync allowlist]
    H -->|Bật/tắt thẻ| N[Update DB + sync allowlist]
    H -->|Xóa thẻ| O[Delete DB + log + sync allowlist]

    I --> P[POST backend /api/device/sync-access]
    L --> P
    N --> P
    O --> P
    P --> Q{Device HTTP endpoint đã discovery?}
    Q -- Yes --> R[POST :82/api/config full config + allowlist]
    Q -- No --> S[PUB retained command/config fallback nếu MQTT connected]
    R --> T{HTTP OK?}
    T -- Yes --> U[Device apply + persist allowlist]
    T -- No --> S
    S --> V{MQTT connected?}
    V -- Yes --> W[Device nhận command/config qua MQTT]
    V -- No --> X[DB đã lưu; lần endpoint/MQTT sau sẽ sync lại]
```

Mỗi lần sync, allowlist được deduplicate, normalize và cắt tối đa 32 UID trước khi gửi xuống device. Nếu HTTP sync thành công, backend vẫn refresh retained MQTT bootstrap URL; full config chỉ retained khi cần fallback.

## 11. UC-09 - FOMO, exact event frame và Rekognition

```mermaid
sequenceDiagram
    autonumber
    participant D as ESP32 FOMO
    participant B as Express Backend
    participant DB as Supabase
    participant AWS as Rekognition
    participant M as MQTT Broker

    D->>D: Camera baseline + scene-change analysis
    alt AI detection tắt
        D->>D: Không chạy FOMO, vẫn chạy camera-tamper
    else Chưa đủ 1.5 giây cooldown hoặc thay đổi dưới threshold
        D->>D: Không inference; tiếp tục stability timer nếu có
    else Đủ điều kiện
        D->>D: Cache JPEG với event_id, chạy FOMO
    end

    alt Không có detection
        D->>D: Không queue HTTP result
    else Có detection
        D->>D: Queue inference JSON
        loop Cho đến khi HTTP hoặc fallback giao được
            alt Wi-Fi mất hoặc HTTP lỗi
                D->>M: PUB telemetry/inference MQTT fallback nếu broker connected
                M-->>B: telemetry/inference fallback
                alt MQTT cũng lỗi
                    D->>D: Chờ retry; nếu có event mới thì thay event cũ
                end
            else Gửi được
                D->>B: POST /api/fomo/inference + device id
                B-->>D: 202 Accepted
            end
        end
    end

    alt Device id/body/event/label/confidence không hợp lệ
        B-->>D: 401 hoặc 422
    else confidence <= 0.7
        B->>B: Cập nhật snapshot, không log AI/recognition
    else confidence > 0.7
        B->>D: GET :82/event-frame?event_id=N
        alt Header event id khớp và có image
            D-->>B: Exact JPEG + X-EdgeGuard-Event-Id
        else HTTP exact frame lỗi
            B->>B: Thử exact MQTT event cache legacy
            alt Không có exact cache
                B->>B: Tiếp tục không ảnh, không thay bằng live frame mới
            end
        end
        B->>DB: Insert AI log một lần cho event
    end

    alt Detection không phải person
        B->>B: Không gọi Rekognition
    else Person + có exact image
        B->>AWS: Detect/search faces, threshold 75
        AWS-->>B: Matched/unmatched faces
        B->>DB: Lookup face id -> display name
        B->>D: POST :82/api/command vision-result kèm event_id
        alt HTTP command lỗi
            B->>M: PUB command/vision-result fallback
            M-->>D: Recognition result
        end
        alt Tất cả người đều quen
            B->>DB: Insert face_recognized info event
            D->>D: Track known person, không stranger alert
        else Có ít nhất một stranger
            D->>D: Bắt đầu stranger stability timer
        end
    else Person nhưng thiếu ảnh hoặc Rekognition lỗi
        B->>D: POST :82/api/command vision-result verified=false + reason
        alt HTTP command lỗi
            B->>M: PUB command/vision-result fallback
        end
        D->>D: Giữ trạng thái waiting cho đến lần reclassify sau
    end
```

`[NEW]` HTTP delivery chạy task riêng, retry khi offline/lỗi và ưu tiên inference mới nhất. Nếu HTTP inference lỗi nhưng MQTT còn kết nối, firmware publish fallback vào `{base}/telemetry/inference`. Backend tuyệt đối không dùng live frame mới thay cho exact event frame sai/mất `event_id`.

## 12. UC-10 - Các branch vision alert

```mermaid
flowchart TD
    A[Frame analysis] --> B{Camera-block candidate?}
    B -- Yes --> C[Tăng consecutive blocked samples]
    C --> D{Đủ số sample xác nhận?}
    D -- No --> E[Chặn FOMO cho frame này]
    D -- Yes --> F[Set camera_blocked=true]
    F --> G{camera_blocked_alert_enabled?}
    G -- No --> E
    G -- Yes --> H[Queue 1 camera_blocked alert]

    B -- No --> I[Reset blocked sample, cập nhật tamper baseline]
    I --> J{Vừa hồi phục từ blocked?}
    J -- Yes --> K[Reset FOMO baseline]
    J -- No --> L{AI enabled + scene change đủ threshold?}
    K --> L

    L -- No --> M{Đang track stranger/object và đủ vision_stable_alert_ms?}
    L -- Yes --> N[Run FOMO + cập nhật state]
    N --> O{Loại detection}
    O -->|Person| P[Chờ UC-09 Rekognition]
    O -->|Bag/package/object| Q[Bắt đầu object stability timer]
    O -->|Không còn detection| R[Về monitoring]

    M -- No --> S[Tiếp tục monitor]
    M -- Yes --> T{State}
    T -->|Stranger + setting enabled| U[Queue stranger_detected]
    T -->|Object + setting enabled| V[Queue object_left]

    H --> W[POST /api/device/telemetry visionAlert]
    U --> W
    V --> W
    W --> X{HTTP accepted?}
    X -- No --> Y[PUB telemetry/vision-alert MQTT fallback nếu broker connected]
    Y --> Y2{MQTT accepted?}
    Y2 -- No --> Y3[Requeue alert ở đầu hàng đợi]
    Y2 -- Yes --> Z
    X -- Yes --> Z[Backend fetch exact frame + insert security event]
```

Camera-block có độ ưu tiên cao hơn FOMO và vẫn được phân tích khi AI bị tắt. Một blocked episode chỉ gửi một alert; khi camera hồi phục thì reset baseline và cho phép alert mới ở episode sau. Object-left/stranger alert dùng thời gian ổn định từ `object_left_max_seconds` sau khi backend sync thành `vision_stable_alert_ms`.

## 13. UC-11 - Quản lý khuôn mặt quen

```mermaid
flowchart TD
    A[Admin thêm face] --> B{Admin + Supabase OK?}
    B -- No --> C[403 hoặc 503]
    B -- Yes --> D{Tên hợp lệ và ảnh <= 2.5 MB?}
    D -- No --> E[413/422]
    D -- Yes --> F[Upload Storage known-faces]
    F --> G{Upload OK?}
    G -- No --> H[400, không tạo DB row]
    G -- Yes --> I[Insert known_faces row]
    I --> J{Insert DB OK?}
    J -- No --> K[Rollback Storage]
    J -- Yes --> L{Có ảnh + Rekognition configured?}
    L -- No --> M[Trả face chưa có rekognition_face_id]
    L -- Yes --> N[IndexFaces]
    N --> O{Face đạt chất lượng?}
    O -- Yes --> P[Save faceId, trả 201]
    O -- No --> Q[Delete DB row + Storage, trả 422]
    N -->|AWS error| R[Delete DB row + Storage, trả 500]

    S[Admin xóa face] --> T[Đọc Storage path + faceId]
    T --> U[Thử DeleteFaces trên AWS]
    U --> V[Soft-delete DB và xóa các reference]
    V --> W[Thử xóa Storage]
    W --> X[Trả thêm storageDeleted, rekognitionDeleted]
```

Nhánh xóa là best-effort với AWS/Storage: DB vẫn có thể soft-delete thành công dù một dịch vụ ngoài thất bại.

## 14. UC-12 - Dashboard và lịch sử sự kiện

```mermaid
flowchart TD
    A[User mở dashboard] --> B[GET /api/status]
    B --> C{Backend device status OK?}
    C -- No --> D[502 Backend unavailable]
    C -- Yes --> E{Supabase settings OK?}
    E -- No --> F[400 settings error]
    E -- Yes --> G[Merge device snapshot + settings + integration flags]
    G --> H[Dashboard hiện door, motion, camera, AI, auto-lock]

    I[User mở logs] --> J[GET /api/events?filter]
    J --> K[Filter all/person/object/door/rfid]
    K --> L{User là admin?}
    L -- No --> M[Ẩn event is_admin_only]
    L -- Yes --> N[Lấy tối đa 60 event]
    M --> O[Join security_event_views theo Telegram user]
    N --> O
    O --> P[Hiện new/seen, severity, image và AI overlay]
    P --> Q[User mở event hoặc mark all]
    Q --> R[POST /api/events eventId/eventIds]
    R --> S[Upsert viewed_at theo device + telegram user + event]
```

AI overlay trên dashboard chỉ hiện inference mới trong 6 giây. Live frame chính đi qua HTTP camera proxy; MQTT frame cache legacy chỉ được coi là mới trong 5 giây.

## 15. UC-13 - Phân quyền và Telegram user

```mermaid
flowchart TD
    A[Request từ Mini App] --> B[Đọc x-telegram-user-id/name]
    B --> C{Dev mode, debug admin, hoặc Supabase chưa config?}
    C -- Yes --> D[Coi request là admin]
    C -- No --> E{Telegram ID nằm trong ADMIN_TELEGRAM_IDS?}
    E -- Yes --> F[Upsert admin active]
    E -- No --> G{Có user active trong DB?}
    G -- No --> H[Role user, không có admin API]
    G -- Yes --> I[Code hiện tại trả role admin]

    D --> J[Admin API: settings/cards/faces/users]
    F --> J
    I --> J
    J --> K{Quản lý user}
    K -->|Add| L[Upsert user active]
    K -->|Delete| M[Set inactive, không tác động row role=admin]
```

`[GAP]` `server-auth.ts` hiện trả `role: admin` cho mọi user active dù field `role` trong DB. Nếu mục tiêu là có role `user` chỉ xem dashboard/log, branch này cần được sửa trước production.

## 16. UC-14 - Standalone CameraCapture

Luồng này độc lập, không qua MQTT, Express hay Next.js:

```mermaid
flowchart TD
    A[GPIO13 click / serial c,f] --> B{Đang có pending image?}
    B -- Yes --> C[Không nhận capture mới]
    B -- No --> D[Capture JPEG theo profile]
    D --> E[Cache PSRAM + LittleFS pending.jpg]
    E --> F{Wi-Fi/Supabase upload OK?}
    F -- No --> G[Giữ đúng ảnh, retry mỗi 10 giây]
    G --> H{Device reboot?}
    H -- Yes --> I[Restore pending.jpg từ LittleFS]
    H -- No --> F
    I --> F
    F -- Yes --> J[Upload Supabase Storage]
    J --> K{Insert event_images OK?}
    K -- No --> G
    K -- Yes --> L[Xóa pending cache, lưu metadata NVS]
    L --> M[GET /api/images hiện lịch sử trên UI firmware]

    N[Phone browser record video] --> O[Đọc MJPEG frames]
    O --> P[Encode/buffer trên phone]
    P --> Q[Share hoặc download MP4/WebM]
```

Video không được device encode, không upload Supabase và không đi qua server EdgeGuard.

## 17. UC-15 - Luồng legacy và luồng chưa nối đầy đủ

### 17.1 Ảnh qua MQTT `[LEGACY]`

Backend vẫn subscribe:

```text
{base}/image
{base}/image/json
{base}/image/event/+
```

Ảnh retained bị backend xóa ngay để tránh dùng frame cũ. Main firmware hiện dùng HTTP cho live/exact frame và không còn publish exact event JPEG qua MQTT.

### 17.2 AI MQTT worker `[GAP]`

```mermaid
flowchart LR
    D[Device telemetry/#] --> M[MQTT broker]
    M --> W[Python AI worker]
    W -->|model/inference| M
    M -.->|Backend chỉ subscribe telemetry/inference| X[Không được xử lý]
```

Worker `ai-models/src/edgeguard_models/mqtt_inference.py` vẫn publish `{base}/model/inference`, nhưng `mini-app/backend/services/mqtt-service.js` chỉ xử lý `{base}/telemetry/inference` làm fallback cho FOMO firmware. FOMO HTTP là AI path đang hoạt động.

### 17.3 Settings chưa được enforce end-to-end `[GAP]`

| Setting | Được lưu DB | Được đồng bộ/enforce |
|---|---|---|
| Auto-lock | Có | Có, device |
| Camera live publishing | Có | Có, device |
| AI detection | Có | Có, device |
| Camera blocked alert | Có | Có, device |
| RFID configuration/master mode | Có | Có, backend card flow |
| Object-left enabled/max seconds | Có | Có, device qua `object_left_alert_enabled` + `vision_stable_alert_ms` |
| Stranger alert enabled | Có | Có, device qua `stranger_alert_enabled` |
| Telegram alert enabled | Có | Chưa; Telegram service chưa được gọi trong event flow |

Telegram service hiện tại chỉ là placeholder tạo link giả lập và không được khởi tạo/gọi bởi event pipeline.

## 18. UC-16 - API vận hành, test và manual event

```mermaid
flowchart TD
    A[Operator / dev client] --> B{Endpoint}
    B -->|GET /health| C[Express + MQTT + FOMO health]
    B -->|GET /api/device/status| C2[HTTP/MQTT device snapshot]
    B -->|POST /api/device/telemetry| C3[Nhận telemetry HTTP từ device]
    B -->|POST /api/device/command| C4[Gửi command HTTP-first, MQTT fallback]
    B -->|POST /api/device/config| C5[Gửi config HTTP-first, MQTT fallback]
    B -->|POST /api/device/sync-access| C6[Sync settings/RFID allowlist HTTP-first]
    B -->|GET /api/camera/status| D[Camera endpoint discovery status]
    B -->|GET /api/fomo/status| E[FOMO URL + last event + HTTP failures]
    B -->|POST /api/mqtt/config| F{Body là object?}
    F -- Yes --> G[Compatibility: publishConfig HTTP-first]
    F -- No --> H[422]
    B -->|POST /api/mqtt/send| I{Topic hợp lệ?}
    I -- Yes --> J[PUB custom MQTT payload]
    I -- No --> H
    B -->|POST /api/mqtt/events| K{Alert payload hợp lệ?}
    K -- Yes --> L[Capture live frame nếu có + insert alert]
    K -- No --> H
    B -->|POST /api/images| M{Base64 image hợp lệ, đúng type và size?}
    M -- Yes --> N[Upload manual-uploads + insert event_images]
    M -- No --> O[500 qua global error handler]
    B -->|GET /api/images/*| P[Đọc danh sách/file local legacy]

    G --> Q{HTTP device OK hoặc MQTT connected?}
    J --> Q
    Q -- No --> R[Global 500: MQTT client is not connected]
    Q -- Yes --> S[200 OK]
```

`[GAP]` `GET /api/images` đọc thư mục local `data/images`, trong khi luồng upload hiện tại đưa ảnh vào Supabase Storage và không ghi file local. Vì vậy danh sách local có thể rỗng trừ khi có artifact cũ bên ngoài.

## 19. MQTT topic contract

| Topic | Chiều | Retain | Xử lý |
|---|---|---|---|
| `{base}/status` | Device -> Server | Có | `online`; LWT `offline` |
| `{base}/telemetry/system` | Device -> Server | Không | MQTT fallback cho health và FOMO/telemetry HTTP metrics |
| `{base}/telemetry/environment` | Producer -> Server | Không | Temperature/humidity; main firmware chưa publish |
| `{base}/telemetry/power` | Producer -> Server | Không | Raw snapshot; main firmware chưa publish |
| `{base}/telemetry/security` | Device -> Server | Không | MQTT fallback cho door/motion + tạo event |
| `{base}/telemetry/nfc` | Device -> Server | Không | MQTT fallback cho RFID validation |
| `{base}/telemetry/endpoints` | Device -> Server | Có | Camera discovery + config resync |
| `{base}/telemetry/vision-alert` | Device -> Server | Không | MQTT fallback cho stranger/object/camera-blocked |
| `{base}/telemetry/inference` | Device -> Server | Không | MQTT fallback cho FOMO inference HTTP |
| `{base}/command/config` | Server -> Device | Có | Retained bootstrap URL; full config fallback khi HTTP lỗi |
| `{base}/command/servo` | Server -> Device | Không | MQTT fallback cho lock/unlock |
| `{base}/command/alarm` | Server -> Device | Không | MQTT fallback cho urgent buzzer |
| `{base}/command/buzzer` | Server -> Device | Không | MQTT fallback cho tone có thời hạn |
| `{base}/command/vision-result` | Server -> Device | Không | MQTT fallback cho recognition result theo event id |
| `{base}/command/reboot` | Server -> Device | Không | MQTT fallback cho restart device |
| `{base}/image*` | Device -> Server | Không | Ảnh legacy |

## 20. HTTP contract chính

| Endpoint | Caller -> Callee | Mục đích |
|---|---|---|
| `POST /api/fomo/inference` | Device -> Express | Gửi FOMO inference |
| `GET /api/fomo/status` | Operator -> Express | Chẩn đoán FOMO HTTP `[NEW]` |
| `GET /api/device/status` | Next.js/operator -> Express | Snapshot device HTTP/MQTT |
| `POST /api/device/telemetry` | Device -> Express | Nhận telemetry HTTP-first |
| `POST /api/device/command` | Next.js/dev -> Express | Gửi command HTTP-first, MQTT fallback |
| `POST /api/device/config` | Next.js/dev -> Express | Gửi config HTTP-first, MQTT fallback |
| `POST /api/device/sync-access` | Next.js -> Express | Sync settings/RFID allowlist HTTP-first |
| `POST :82/api/command` | Express -> Device | Nhận command trực tiếp trên ESP32 |
| `POST :82/api/config` | Express -> Device | Nhận config trực tiếp trên ESP32 |
| `GET :82/event-frame?event_id=` | Express -> Device | Lấy exact frame |
| `GET :82/capture` | Express -> Device | Lấy live JPEG |
| `GET :81/stream` | Express -> Device | Lấy MJPEG |
| `POST /api/mqtt/command` | Next.js/dev -> Express | Compatibility command; vẫn HTTP-first rồi MQTT fallback |
| `POST /api/mqtt/sync-access` | Next.js/dev -> Express | Compatibility sync; vẫn HTTP-first rồi MQTT fallback |
| `GET /api/mqtt/status` | Next.js/dev -> Express | Compatibility snapshot hệ thống |
| `GET /api/camera/stream` | App -> Express | Proxy MJPEG |
| `GET /api/camera/frame` | App -> Express | Proxy JPEG fallback |
| `GET,POST /api/settings` | App -> Next.js | Đọc/lưu settings và trigger config sync |
| `GET,POST,PUT,DELETE /api/cards` | App -> Next.js | RFID CRUD và pending approval |
| `GET,POST,DELETE /api/faces` | App -> Next.js | Known-face CRUD + Storage/Rekognition |
| `GET,POST,DELETE /api/users` | App -> Next.js | Telegram user management |
| `GET,POST /api/events` | App -> Next.js | Đọc/filter event và mark viewed |
| `POST /api/door` | App -> Next.js | Lock/unlock |
| `POST /api/alarm` | App -> Next.js | Bật/tắt alarm |
| `GET /api/me` | App -> Next.js | Role hiện tại |
| `POST /api/images` | Dev -> Express | Manual base64 image upload |
| `POST /api/mqtt/events` | Dev -> Express | Tạo manual security event |

## 21. Note các use case/branch mới

1. `[NEW]` Camera HTTP tách thành control port `82` và MJPEG port `81`.
2. `[NEW]` Endpoint announcement có `event_frame_url`, `stream_port`, `live_mode=mjpeg`.
3. `[NEW]` Device telemetry/RFID/vision alert dùng `POST /api/device/telemetry` trước, MQTT topic tương ứng chỉ là fallback.
4. `[NEW]` Command/config từ backend sang ESP32 dùng `POST :82/api/command` và `POST :82/api/config` trước, MQTT command/config chỉ là fallback.
5. `[NEW]` Backend chọn `backend_url`/FOMO HTTP URL theo LAN/subnet của device và resync khi nhận endpoint.
6. `[NEW]` Retained MQTT config bình thường chỉ giữ bootstrap URL; full operational config retained khi HTTP delivery thất bại.
7. `[NEW]` FOMO HTTP delivery có task riêng, retry và thay pending event cũ bằng event mới hơn; nếu HTTP lỗi có fallback `{base}/telemetry/inference`.
8. `[NEW]` `GET /api/fomo/status` trả URL, event cuối và thống kê lỗi HTTP từ device.
9. `[NEW]` Exact event frame không fallback sang live frame mới; sai/mất `X-EdgeGuard-Event-Id` thì event được lưu không ảnh.
10. `[NEW]` Camera-tamper chạy độc lập với FOMO AI; `camera_blocked_alert_enabled` chỉ gate việc publish alert.
11. `[NEW]` Object-left/stranger alert đã được gate bằng setting và dùng `vision_stable_alert_ms` sync từ `object_left_max_seconds`.
12. `[NEW]` Vision alert payload được rút gọn; nếu HTTP và MQTT đều lỗi thì requeue thay vì bỏ mất.

## 22. Nguồn code đối chiếu

| Phạm vi | File chính |
|---|---|
| Device lifecycle/MQTT/config | `hardware/EdgeGuardDevice/EdgeGuardDevice.ino`, `mqtt.h`, `http_transport.h`, `device.h` |
| RFID/door/alarm | `pn532_reader.h`, `actuators.h`, `sensors.h` |
| Camera/FOMO | `camera.h`, `fomo.h` |
| Backend orchestration | `mini-app/backend/services/mqtt-service.js` |
| Backend routes | `mini-app/backend/routes/device.js`, `mqtt.js`, `camera.js`, `fomo.js` |
| Mini App API | `mini-app/src/app/api/*` |
| DB/Storage | `schema.sql`, `mini-app/backend/services/supabase-service.js` |
| Standalone camera | `hardware/CameraCapture/README.md`, `CameraCapture.ino` |
| Legacy AI worker | `ai-models/src/edgeguard_models/mqtt_inference.py` |
