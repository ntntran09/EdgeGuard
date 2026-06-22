// Telegram WebApp types
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    query_id?: string;
  };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
  };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  expand(): void;
  close(): void;
  ready(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

// Domain types
export type EventType =
  | 'access_granted'
  | 'access_denied'
  | 'person_detected'
  | 'stranger_detected'
  | 'object_detected'
  | 'object_left'
  | 'unknown_object'
  | 'camera_blocked'
  | 'door_unlocked'
  | 'door_locked'
  | 'rfid_scan'
  | 'rfid_invalid'
  | 'rfid_added'
  | 'rfid_deleted'
  | 'system_event';
export type EventSeverity = 'info' | 'warning' | 'danger';
export type EventCategory = 'person' | 'object' | 'door' | 'rfid' | 'system';
export type DeviceRole = 'admin' | 'user';

export interface SecurityEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  timestamp: string;
  thumbnailUrl?: string;
  aiConfidence?: number;
  severity: EventSeverity;
  cardId?: string;
  category?: EventCategory;
  isAdminOnly?: boolean;
  isViewed?: boolean;
}

export interface RfidCard {
  id: string;
  cardUid: string;
  name: string;
  isActive: boolean;
  addedAt: string;
  lastUsedAt?: string;
}

export interface PendingRfidScan {
  id: string;
  cardUid: string;
  firstSeenAt: string;
  lastSeenAt: string;
  scanCount: number;
}

export interface TelegramDeviceUser {
  id: string;
  telegramId: string;
  displayName: string;
  role: DeviceRole;
  isActive: boolean;
  addedAt: string;
}

export interface KnownFace {
  id: string;
  displayName: string;
  imageUrl?: string;
  isActive: boolean;
  addedAt: string;
}

export interface CameraStatus {
  isOnline: boolean;
  isBlocked: boolean;
  streamUrl: string;
  lastFrameAt?: string;
}

export interface SystemStatus {
  mqttConnected: boolean;
  doorOpen: boolean;
  motionDetected: boolean;
  temperatureC?: number;
  humidityPct?: number;
  modelLabel?: string;
  anomalyScore?: number;
  lastUpdate?: string;
  latestImageUrl?: string;
  aiDetectionEnabled?: boolean;
  aiModelReady?: boolean;
  telegramEnabled?: boolean;
  telegramConfigured?: boolean;
  autoLockEnabled?: boolean;
  autoLockSeconds?: number | null;
  error?: string;
}

export interface AlertConfig {
  objectLeftAlertEnabled?: boolean;
  objectLeftMaxSeconds: number;
  autoLockEnabled?: boolean;
  autoLockSeconds?: number | null;
  strangerAlertEnabled: boolean;
  cameraBlockedAlertEnabled: boolean;
  telegramAlertEnabled?: boolean;
  aiDetectionEnabled?: boolean;
  masterKeyEnabled?: boolean;
}

export type MascotState = 'idle' | 'alert' | 'happy' | 'sleep';
