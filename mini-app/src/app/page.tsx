'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlarmOffFilledIcon,
  AlarmOnFilledIcon,
  CheckFilledIcon,
  ChevronRightFilledIcon,
  LockFilledIcon,
  LockOpenFilledIcon,
  ShieldFilledIcon,
  WifiFilledIcon,
  getEventFilledIcon,
} from '@/components/icons/FilledIcons';
import { useTelegram } from '@/hooks/useTelegram';
import { api } from '@/lib/api';
import { AI_MIN_CONFIDENCE } from '@/lib/ai-detections';
import { formatDate, formatTimeAgo, getGreeting } from '@/lib/telegram';
import type { AiDetection, SecurityEvent, SystemStatus } from '@/types';

type ToastKind = 'success' | 'error' | 'warn';

function canShowCameraSource(url?: string) {
  if (!url) return false;
  return url.startsWith('data:image/') || url.startsWith('/') || !url.includes('t.me/');
}

function isVideoSource(url?: string) {
  if (!url) return false;
  return /\.(mp4|webm|ogg)(\?|$)/i.test(url);
}

function detectionLabel(detection: AiDetection) {
  if (detection.type === 'person') return 'Người';
  if (detection.type === 'bag') return 'Túi';
  if (detection.type === 'package') return 'Bưu kiện';
  return detection.label;
}

function centroidPercent(value: number, dimension: number) {
  if (!Number.isFinite(value) || !Number.isFinite(dimension) || dimension <= 0) return 0;
  return Math.min(100, Math.max(0, (value / dimension) * 100));
}

export default function DashboardPage() {
  const { user, hapticFeedback } = useTelegram();
  const [doorLoading, setDoorLoading] = useState(false);
  const [alarmLoading, setAlarmLoading] = useState(false);
  const [alarmActive, setAlarmActive] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const activeStatus = useMemo<SystemStatus>(() => status || ({
    mqttConnected: false,
    doorOpen: false,
    motionDetected: false,
    autoLockEnabled: false,
    autoLockSeconds: null,
  }), [status]);
  const doorOpen = Boolean(activeStatus.doorOpen);
  const recentEvents = events;
  const criticalEvent = recentEvents.find((event) => event.severity === 'danger') || recentEvents[0];
  const isSafe = activeStatus.mqttConnected && !alarmActive && !recentEvents.some((event) => event.severity === 'danger');
  const cameraSource =
    process.env.NEXT_PUBLIC_ESP32_CAM_STREAM_URL ||
    process.env.NEXT_PUBLIC_CAMERA_STREAM_URL ||
    activeStatus.latestImageUrl;
  const cameraPublishingEnabled = activeStatus.cameraImagePublishingEnabled !== false;
  const aiDetections = (activeStatus.aiDetections || [])
    .filter((detection) => detection.confidence > AI_MIN_CONFIDENCE);

  const statusCopy = useMemo(() => {
    if (!activeStatus.mqttConnected) return 'Thiết bị ngoại tuyến';
    if (!isSafe) return 'Cần kiểm tra';
    return 'Hệ thống an toàn';
  }, [activeStatus.mqttConnected, isSafe]);

  const showToast = useCallback((msg: string, kind: ToastKind = 'success') => {
    setToast({ msg, kind });
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const [eventsRes, statusRes] = await Promise.all([
        api.getEvents(),
        api.getStatus(),
      ]);
      setEvents(eventsRes.events || []);
      setStatus(statusRes);
    } catch (error) {
      console.error('Failed to load dashboard', error);
      setEvents([]);
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadDashboard();
    }, 0);
    const interval = window.setInterval(loadDashboard, 5000);
    return () => {
      window.clearTimeout(timerId);
      window.clearInterval(interval);
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (!toast) return;
    const timerId = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timerId);
  }, [toast]);

  const handleDoorAction = useCallback(async () => {
    const action = doorOpen ? 'lock' : 'unlock';
    setDoorLoading(true);
    try {
      await api.setDoor(action);
      setStatus((current) => ({
        ...(current || activeStatus),
        doorOpen: action === 'unlock',
      }));
      hapticFeedback('notification', 'success');
      showToast(action === 'unlock' ? 'Đã gửi lệnh mở cửa' : 'Đã gửi lệnh đóng cửa', 'success');
      await loadDashboard();
    } catch {
      hapticFeedback('notification', 'error');
      showToast('Không thể điều khiển cửa, kiểm tra MQTT/backend', 'error');
    } finally {
      setDoorLoading(false);
    }
  }, [activeStatus, doorOpen, hapticFeedback, loadDashboard, showToast]);

  const handleAlarm = useCallback(async () => {
    setAlarmLoading(true);
    try {
      const next = !alarmActive;
      await api.triggerAlarm(next);
      hapticFeedback('notification', next ? 'warning' : 'success');
      setAlarmActive(next);
      showToast(next ? 'Đã kích hoạt báo động' : 'Đã tắt báo động', next ? 'warn' : 'success');
    } catch {
      hapticFeedback('notification', 'error');
      showToast('Không thể đổi trạng thái báo động', 'error');
    } finally {
      setAlarmLoading(false);
    }
  }, [alarmActive, hapticFeedback, showToast]);

  const toastBg: Record<ToastKind, string> = {
    success: 'var(--accent-success)',
    error: 'var(--accent-danger)',
    warn: 'var(--accent-warning)',
  };

  return (
    <div className="dashboard-page">
      {toast && (
        <div className="toast" style={{ background: toastBg[toast.kind] }}>
          {toast.kind === 'success' && <CheckFilledIcon size={16} />}
          {toast.msg}
        </div>
      )}

      <header className="dashboard-header">
        <div>
          <p className="text-caption" style={{ margin: '0 0 2px' }}>{formatDate()}</p>
          <h1 className="text-heading-1" style={{ margin: 0 }}>
            {getGreeting()}, {user?.first_name || 'người dùng'}
          </h1>
        </div>
        <span className={`connection-chip ${activeStatus.mqttConnected ? 'is-online' : 'is-offline'}`}>
          <WifiFilledIcon size={16} />
          {activeStatus.mqttConnected ? 'Trực tuyến' : 'Ngoại tuyến'}
        </span>
      </header>

      <div className="dashboard-grid">
        <main className="dashboard-main-column">
          <section className={`bento-card system-status-card ${isSafe ? '' : 'is-alerting'}`}>
            <div className="status-indicator">
              <div className={`status-ring ${isSafe ? 'ring-success' : 'ring-danger'}`}>
                <ShieldFilledIcon size={34} />
              </div>
            </div>
            <div className="status-details">
              <h2>{statusCopy}</h2>
              <p>
                {activeStatus.lastUpdate
                  ? `Cập nhật ${formatTimeAgo(activeStatus.lastUpdate)}`
                  : 'Đang chờ tín hiệu mới từ ESP32'}
              </p>
            </div>
          </section>

          <section className="insight-strip dashboard-top-insights">
            <div>
              <small>Trạng thái cửa</small>
              <strong>{doorOpen ? 'Đang mở' : 'Đang khóa'}</strong>
            </div>
            <div>
              <small>Tự động khóa</small>
              <strong>{activeStatus.autoLockEnabled === false ? 'Tắt' : `${activeStatus.autoLockSeconds || 10}s`}</strong>
            </div>
            <div>
              <small>Sự kiện gần đây</small>
              <strong>{recentEvents.length}</strong>
            </div>
          </section>

          <section className="quick-actions dashboard-compact-actions">
            <button
              className="quick-action-btn is-success"
              onClick={handleDoorAction}
              disabled={doorLoading}
              id="btn-door-action"
            >
              {doorLoading ? (
                <div className="loading-spinner" />
              ) : doorOpen ? (
                <LockFilledIcon size={22} />
              ) : (
                <LockOpenFilledIcon size={22} />
              )}
              <span>{doorOpen ? 'Đóng cửa' : 'Mở cửa'}</span>
            </button>

            <button
              className="quick-action-btn danger-action"
              onClick={handleAlarm}
              disabled={alarmLoading}
            >
              {alarmLoading ? (
                <div className="loading-spinner action-loading-spinner" />
              ) : alarmActive ? (
                <AlarmOffFilledIcon size={22} />
              ) : (
                <AlarmOnFilledIcon size={22} />
              )}
              <span>{alarmLoading ? 'Đang gửi...' : alarmActive ? 'Tắt báo động' : 'Bật báo động'}</span>
            </button>
          </section>

          <section className="camera-card">
            <div className="camera-live-indicator">
              <span className="camera-live-dot" />
              ESP32-CAM
            </div>
            <span className={`badge camera-badge ${cameraSource ? 'badge-success' : 'badge-warning'}`}>
              {cameraSource ? 'TRỰC TIẾP' : cameraPublishingEnabled ? 'MẤT TÍN HIỆU' : 'ĐÃ TẮT'}
            </span>
            {isVideoSource(cameraSource) ? (
              <video
                key={cameraSource}
                className="camera-feed"
                src={cameraSource}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
              />
            ) : canShowCameraSource(cameraSource) ? (
              // A native img element is required for the multipart MJPEG stream.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="camera-feed" src={cameraSource} alt="Camera chính đang quan sát cửa ra vào" />
            ) : (
              <div className="camera-placeholder">
                <ShieldFilledIcon size={42} />
                <span>{cameraPublishingEnabled ? 'Chưa có luồng camera' : 'Gửi ảnh camera đang tắt'}</span>
                <small>
                  {cameraPublishingEnabled
                    ? 'Cấu hình NEXT_PUBLIC_ESP32_CAM_STREAM_URL để xem stream từ ESP32-CAM'
                    : 'Bật lại trong Cài đặt → Hệ thống để xem luồng trực tiếp'}
                </small>
              </div>
            )}
            {cameraSource && aiDetections.length > 0 && (
              <div className="ai-centroid-layer" aria-label="Tâm các phát hiện AI trên khung hình">
                {aiDetections.map((detection, index) => (
                  <span
                    className="ai-centroid-marker"
                    key={`${detection.label}-${detection.centroidX}-${detection.centroidY}-${index}`}
                    style={{
                      left: `${centroidPercent(detection.centroidX, detection.inputWidth)}%`,
                      top: `${centroidPercent(detection.centroidY, detection.inputHeight)}%`,
                    }}
                  >
                    <span className="ai-centroid-label">
                      {detectionLabel(detection)} {Math.round(detection.confidence * 100)}%
                      {' · '}
                      ({Math.round(detection.centroidX)}, {Math.round(detection.centroidY)})
                    </span>
                  </span>
                ))}
              </div>
            )}
          </section>

        </main>

        <aside className="dashboard-side-column">
          {criticalEvent && (
            <Link href="/logs" className="dashboard-primary-notification">
              <span className="dashboard-primary-notification-icon">
                {getEventFilledIcon(criticalEvent.type, { size: 22 })}
              </span>
              <span className="dashboard-primary-notification-copy">
                <strong>{criticalEvent.title}</strong>
                <small>{criticalEvent.description}</small>
                <span>
                  {formatTimeAgo(criticalEvent.timestamp)}
                  {criticalEvent.aiConfidence && <b>AI {Math.round(criticalEvent.aiConfidence * 100)}%</b>}
                </span>
              </span>
              <ChevronRightFilledIcon className="dashboard-primary-notification-chevron" size={18} />
            </Link>
          )}

          <section className="bento-card recent-panel">
            <div className="panel-heading compact">
              <div>
                <h2 className="text-heading-3">Lịch sử gần đây</h2>
                <p className="text-caption">{recentEvents.length} sự kiện mới nhất</p>
              </div>
              <Link href="/logs" className="inline-link">
                Xem tất cả <ChevronRightFilledIcon size={16} />
              </Link>
            </div>

            <div className="recent-list stagger-children">
              {recentEvents.slice(0, 6).map((event) => (
                <Link href="/logs" className="event-item compact-event" key={event.id}>
                  <span className={`event-thumbnail event-${event.severity}`}>
                    {getEventFilledIcon(event.type, { size: 20 })}
                  </span>
                  <span className="recent-event-copy">
                    <strong>{event.title}</strong>
                    <small>{event.description}</small>
                  </span>
                  <span className="recent-event-meta">
                    <small>{formatTimeAgo(event.timestamp)}</small>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
