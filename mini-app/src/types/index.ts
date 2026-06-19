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
export type EventType = 'access_granted' | 'access_denied' | 'stranger_detected' | 'object_left' | 'camera_blocked' | 'rfid_scan';
export type EventSeverity = 'info' | 'warning' | 'danger';

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
}

export interface RfidCard {
  id: string;
  cardUid: string;
  name: string;
  isActive: boolean;
  addedAt: string;
  lastUsedAt?: string;
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
  lastUpdate?: string;
}

export interface AlertConfig {
  objectLeftMaxSeconds: number;
  strangerAlertEnabled: boolean;
  cameraBlockedAlertEnabled: boolean;
}

export type MascotState = 'idle' | 'alert' | 'happy' | 'sleep';
