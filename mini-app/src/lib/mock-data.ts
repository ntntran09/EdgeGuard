import type { SecurityEvent, RfidCard, CameraStatus, SystemStatus, AlertConfig } from '@/types';

export const mockEvents: SecurityEvent[] = [
  {
    id: '1',
    type: 'stranger_detected',
    title: 'Phát hiện người lạ',
    description: 'Phát hiện 1 người lạ trước cửa',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    thumbnailUrl: '/thumbnails/stranger.png',
    aiConfidence: 0.92,
    severity: 'danger',
  },
  {
    id: '2',
    type: 'access_granted',
    title: 'Truy cập hợp lệ',
    description: 'Thẻ RFID #A3F2 - Nguyễn Văn A',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    thumbnailUrl: '/thumbnails/access.png',
    severity: 'info',
    cardId: 'card-1',
  },
  {
    id: '3',
    type: 'access_denied',
    title: 'Truy cập bị từ chối',
    description: 'Thẻ không hợp lệ #FF91',
    timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    thumbnailUrl: '/thumbnails/denied.png',
    aiConfidence: 0.98,
    severity: 'warning',
  },
  {
    id: '4',
    type: 'object_left',
    title: 'Vật thể bị bỏ quên',
    description: 'Phát hiện balo bị bỏ quên trước cửa',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    thumbnailUrl: '/thumbnails/object.png',
    aiConfidence: 0.87,
    severity: 'warning',
  },
  {
    id: '5',
    type: 'rfid_scan',
    title: 'Quét thẻ RFID',
    description: 'Thẻ RFID #B7C4 - Trần Thị B',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    thumbnailUrl: '/thumbnails/access.png',
    severity: 'info',
    cardId: 'card-2',
  },
  {
    id: '6',
    type: 'access_granted',
    title: 'Truy cập hợp lệ',
    description: 'Thẻ RFID #A3F2 - Nguyễn Văn A',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    thumbnailUrl: '/thumbnails/access.png',
    severity: 'info',
    cardId: 'card-1',
  },
  {
    id: '7',
    type: 'camera_blocked',
    title: 'Camera bị che',
    description: 'Camera chính bị che hoặc mờ',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    thumbnailUrl: '/thumbnails/blocked.png',
    aiConfidence: 0.95,
    severity: 'danger',
  },
  {
    id: '8',
    type: 'stranger_detected',
    title: 'Phát hiện người lạ',
    description: 'Phát hiện 2 người lạ lúc rạng sáng',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    thumbnailUrl: '/thumbnails/stranger.png',
    aiConfidence: 0.89,
    severity: 'danger',
  },
];

export const mockCards: RfidCard[] = [
  {
    id: 'card-1',
    cardUid: 'A3:F2:8B:01',
    name: 'Nguyễn Văn A',
    isActive: true,
    addedAt: '2025-01-15T08:00:00Z',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: 'card-2',
    cardUid: 'B7:C4:3E:92',
    name: 'Trần Thị B',
    isActive: true,
    addedAt: '2025-02-20T10:30:00Z',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: 'card-3',
    cardUid: 'D1:5A:F7:44',
    name: 'Lê Văn C',
    isActive: true,
    addedAt: '2025-03-10T14:00:00Z',
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: 'card-4',
    cardUid: 'E8:2C:91:A5',
    name: 'Phạm Thị D (Khách)',
    isActive: false,
    addedAt: '2025-04-05T09:00:00Z',
  },
];

export const mockCameraStatus: CameraStatus = {
  isOnline: true,
  isBlocked: false,
  streamUrl: process.env.NEXT_PUBLIC_CAMERA_STREAM_URL || 'http://192.168.1.100:81/stream',
  lastFrameAt: new Date().toISOString(),
};

export const mockSystemStatus: SystemStatus = {
  mqttConnected: true,
  doorOpen: false,
  motionDetected: false,
  temperatureC: 28.4,
  humidityPct: 65,
  lastUpdate: new Date().toISOString(),
};

export const defaultAlertConfig: AlertConfig = {
  objectLeftMaxSeconds: 60,
  strangerAlertEnabled: true,
  cameraBlockedAlertEnabled: true,
};
