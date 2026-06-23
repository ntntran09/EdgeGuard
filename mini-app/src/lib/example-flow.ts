import type { EventCategory, EventSeverity, EventType, SecurityEvent } from '@/types';

type ExampleFlowKey = 'open_rfid' | 'configure_rfid' | 'configure_faces' | 'stranger' | 'suspicious_object' | 'blocked_camera';

interface ExampleEvent {
  offsetSeconds: number;
  type: EventType;
  title: string;
  description: string;
  severity: EventSeverity;
  category: EventCategory;
  aiConfidence?: number;
  cardId?: string;
  thumbnailUrl?: string;
  isAdminOnly?: boolean;
}

interface DoorWindow {
  from: number;
  to: number;
}

interface ExampleFlow {
  key: ExampleFlowKey;
  label: string;
  videoUrl: string;
  durationSeconds: number;
  doorOpenWindows?: DoorWindow[];
  dangerWindows?: DoorWindow[];
  events: ExampleEvent[];
}

const startedAt = Date.now();

export const exampleFlows: Record<ExampleFlowKey, ExampleFlow> = {
  open_rfid: {
    key: 'open_rfid',
    label: 'RFID/NFC unlock demo',
    videoUrl: '/video/open_rfid/open_rfid-browser.mp4',
    durationSeconds: 10,
    doorOpenWindows: [{ from: 6, to: 10 }],
    events: [
      {
        offsetSeconds: 1,
        type: 'person_detected',
        title: 'Phát hiện người quen',
        description: 'Camera cửa nhận diện người dùng quen đang đứng trước cửa',
        severity: 'info',
        category: 'person',
        aiConfidence: 0.91,
        thumbnailUrl: '/video/open_rfid/thumb-person.jpg',
      },
      {
        offsetSeconds: 4,
        type: 'rfid_scan',
        title: 'Quét thẻ RFID/NFC',
        description: 'Thẻ A3:F2:8B:01 được đặt gần đầu đọc',
        severity: 'info',
        category: 'rfid',
        cardId: 'A3:F2:8B:01',
        thumbnailUrl: '/video/open_rfid/thumb-rfid.jpg',
      },
      {
        offsetSeconds: 5,
        type: 'access_granted',
        title: 'Truy cập hợp lệ',
        description: 'RFID/NFC hợp lệ, gửi lệnh mở khóa đến servo',
        severity: 'info',
        category: 'rfid',
        cardId: 'A3:F2:8B:01',
        thumbnailUrl: '/video/open_rfid/thumb-access-granted.jpg',
      },
      {
        offsetSeconds: 6,
        type: 'door_unlocked',
        title: 'Cửa đã mở khóa',
        description: 'Servo mở khóa cửa theo lệnh xác thực thành công',
        severity: 'info',
        category: 'door',
        thumbnailUrl: '/video/open_rfid/thumb-door-unlocked.jpg',
      },
    ],
  },
  configure_rfid: {
    key: 'configure_rfid',
    label: 'RFID/NFC card configuration demo',
    videoUrl: '/video/open_rfid/open_rfid-browser.mp4',
    durationSeconds: 12,
    events: [
      {
        offsetSeconds: 1,
        type: 'system_event',
        title: 'Bật cấu hình thẻ RFID/NFC',
        description: 'Admin bật chế độ cấu hình để hệ thống nhận thẻ mới đang chờ duyệt',
        severity: 'info',
        category: 'system',
      },
      {
        offsetSeconds: 3,
        type: 'rfid_scan',
        title: 'Quét thẻ RFID/NFC mới',
        description: 'Thẻ C9:71:4D:20 chưa có trong hệ thống, được đưa vào danh sách chờ duyệt',
        severity: 'info',
        category: 'rfid',
        cardId: 'C9:71:4D:20',
        thumbnailUrl: '/video/open_rfid/thumb-rfid.jpg',
        isAdminOnly: true,
      },
      {
        offsetSeconds: 7,
        type: 'rfid_added',
        title: 'Thêm thẻ RFID/NFC',
        description: 'Admin duyệt thẻ C9:71:4D:20 và cấp quyền truy cập',
        severity: 'info',
        category: 'rfid',
        cardId: 'C9:71:4D:20',
        thumbnailUrl: '/video/open_rfid/thumb-access-granted.jpg',
        isAdminOnly: true,
      },
    ],
  },
  configure_faces: {
    key: 'configure_faces',
    label: 'Face configuration demo',
    videoUrl: '/video/stranger/stranger-browser.mp4',
    durationSeconds: 12,
    events: [
      {
        offsetSeconds: 1,
        type: 'system_event',
        title: 'Cấu hình gương mặt quen',
        description: 'Admin mở danh sách gương mặt quen với hai hồ sơ mẫu đã có sẵn',
        severity: 'info',
        category: 'system',
      },
      {
        offsetSeconds: 4,
        type: 'person_detected',
        title: 'Nhận diện gương mặt quen',
        description: 'Camera đối chiếu gương mặt với danh sách mẫu trong luồng demo',
        severity: 'info',
        category: 'person',
        aiConfidence: 0.91,
        thumbnailUrl: '/video/stranger/thumb-person.jpg',
      },
      {
        offsetSeconds: 8,
        type: 'system_event',
        title: 'Thêm gương mặt trong demo',
        description: 'Ảnh được xử lý trong chế độ example và không ghi vào Supabase',
        severity: 'info',
        category: 'system',
      },
    ],
  },
  stranger: {
    key: 'stranger',
    label: 'Stranger detection demo',
    videoUrl: '/video/stranger/stranger-browser.mp4',
    durationSeconds: 10,
    dangerWindows: [{ from: 3, to: 10 }],
    events: [
      {
        offsetSeconds: 2,
        type: 'person_detected',
        title: 'Phát hiện người trước cửa',
        description: 'Camera cửa phát hiện một người đứng gần khu vực cửa',
        severity: 'info',
        category: 'person',
        aiConfidence: 0.9,
        thumbnailUrl: '/video/stranger/thumb-person.jpg',
      },
      {
        offsetSeconds: 4,
        type: 'stranger_detected',
        title: 'Phát hiện người lạ',
        description: 'AI không khớp với danh sách gương mặt quen, gửi cảnh báo đến chủ nhà',
        severity: 'danger',
        category: 'person',
        aiConfidence: 0.92,
        thumbnailUrl: '/video/stranger/thumb-stranger.jpg',
      },
    ],
  },
  suspicious_object: {
    key: 'suspicious_object',
    label: 'Suspicious object demo',
    videoUrl: '/video/suspicious_object/suspicious_object-browser.mp4',
    durationSeconds: 10,
    dangerWindows: [{ from: 6, to: 10 }],
    events: [
      {
        offsetSeconds: 2,
        type: 'object_detected',
        title: 'Phát hiện vật thể trước cửa',
        description: 'AI phát hiện gói hàng hoặc balo được đặt trên thảm trước cửa',
        severity: 'warning',
        category: 'object',
        aiConfidence: 0.88,
        thumbnailUrl: '/video/suspicious_object/thumb-object.jpg',
      },
      {
        offsetSeconds: 6,
        type: 'object_left',
        title: 'Vật thể bị bỏ lại',
        description: 'Vật thể nằm trước cửa quá ngưỡng demo, tạo sự kiện cảnh báo',
        severity: 'warning',
        category: 'object',
        aiConfidence: 0.87,
        thumbnailUrl: '/video/suspicious_object/thumb-object-left.jpg',
      },
    ],
  },
  blocked_camera: {
    key: 'blocked_camera',
    label: 'Blocked camera demo',
    videoUrl: '/video/blocked_camera/blocked_camera-browser.mp4',
    durationSeconds: 10,
    dangerWindows: [{ from: 4, to: 10 }],
    events: [
      {
        offsetSeconds: 3,
        type: 'camera_blocked',
        title: 'Camera bị che',
        description: 'Tầm nhìn camera bị vật cản che khuất, không thể giám sát bình thường',
        severity: 'danger',
        category: 'system',
        aiConfidence: 0.95,
        thumbnailUrl: '/video/blocked_camera/thumb-blocked.jpg',
      },
      {
        offsetSeconds: 7,
        type: 'system_event',
        title: 'Tín hiệu camera bất thường',
        description: 'Hình ảnh bị mờ hoặc thiếu sáng sau khi camera bị tác động',
        severity: 'warning',
        category: 'system',
        aiConfidence: 0.9,
        thumbnailUrl: '/video/blocked_camera/thumb-camera-warning.jpg',
      },
    ],
  },
};

export function getExampleFlow() {
  const key = process.env.EXAMPLE_FLOW as ExampleFlowKey | undefined;
  if (!key) return null;
  return exampleFlows[key] || null;
}

export function getExampleElapsedSeconds() {
  return Math.max(0, (Date.now() - startedAt) / 1000);
}

export function getExampleEvents() {
  const flow = getExampleFlow();
  if (!flow) return null;

  const elapsed = getExampleElapsedSeconds();
  return flow.events
    .filter((event) => event.offsetSeconds <= elapsed)
    .map((event, index): SecurityEvent => ({
      id: `${flow.key}-${index}`,
      type: event.type,
      title: event.title,
      description: event.description,
      timestamp: new Date(startedAt + event.offsetSeconds * 1000).toISOString(),
      thumbnailUrl: event.thumbnailUrl,
      aiConfidence: event.aiConfidence,
      severity: event.severity,
      cardId: event.cardId,
      category: event.category,
      isAdminOnly: event.isAdminOnly,
      isViewed: false,
    }))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function isExampleDoorOpen() {
  const flow = getExampleFlow();
  if (!flow?.doorOpenWindows) return false;
  const elapsed = getExampleElapsedSeconds();
  return flow.doorOpenWindows.some((window) => elapsed >= window.from && elapsed <= window.to);
}

export function isExampleAlerting() {
  const flow = getExampleFlow();
  if (!flow?.dangerWindows) return false;
  const elapsed = getExampleElapsedSeconds();
  return flow.dangerWindows.some((window) => elapsed >= window.from && elapsed <= window.to);
}
