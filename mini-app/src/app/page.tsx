'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useTelegram } from '@/hooks/useTelegram';
import { getGreeting, formatDate, formatTimeAgo } from '@/lib/telegram';
import {
  AlarmOffFilledIcon,
  AlarmOnFilledIcon,
  BlockFilledIcon,
  CheckFilledIcon,
  ChevronRightFilledIcon,
  LockOpenFilledIcon,
  ShieldFilledIcon,
  WifiFilledIcon,
  getEventFilledIcon,
} from '@/components/icons/FilledIcons';
import { api } from '@/lib/api';
import type { SecurityEvent, SystemStatus } from '@/types';

type ToastKind = 'success' | 'error' | 'warn';

export default function DashboardPage() {
  const { user } = useTelegram();
  const [doorLoading, setDoorLoading] = useState(false);
  const [alarmLoading, setAlarmLoading] = useState(false);
  const [doorSuccess, setDoorSuccess] = useState(false);
  const [alarmActive, setAlarmActive] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const [recentEvents, setRecentEvents] = useState<SecurityEvent[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const showToast = useCallback((msg: string, kind: ToastKind = 'success') => {
    setToast({ msg, kind });
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const [eventsRes, statusRes] = await Promise.all([
        api.getEvents(),
        api.getStatus().catch(() => null),
      ]);

      setRecentEvents(eventsRes.events || []);
      if (statusRes) setStatus(statusRes);
    } catch (error) {
      console.error('Failed to load dashboard', error);
      showToast('Không thể tải dữ liệu giám sát', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void Promise.resolve().then(loadDashboard);

    const interval = window.setInterval(async () => {
      try {
        const statusRes = await api.getStatus();
        setStatus(statusRes);
      } catch {
        setStatus((current) => current ? { ...current, mqttConnected: false } : current);
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [loadDashboard]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const latestAlert = useMemo(
    () => recentEvents.find((event) => event.severity === 'danger' || event.severity === 'warning'),
    [recentEvents]
  );

  const cameraEvent = useMemo(
    () => recentEvents.find((event) => Boolean(event.thumbnailUrl)),
    [recentEvents]
  );

  const stats = useMemo(() => [
    {
      label: 'MQTT',
      value: status?.mqttConnected ? 'Online' : 'Offline',
      tone: status?.mqttConnected ? 'success' : 'danger',
    },
    {
      label: 'Cửa',
      value: status?.doorOpen ? 'Đang mở' : 'Đã khóa',
      tone: status?.doorOpen ? 'warning' : 'success',
    },
    {
      label: 'Chuyển động',
      value: status?.motionDetected ? 'Có tín hiệu' : 'Yên tĩnh',
      tone: status?.motionDetected ? 'warning' : 'neutral',
    },
    {
      label: 'Môi trường',
      value: status?.temperatureC !== undefined ? `${status.temperatureC.toFixed(1)}°C` : '--',
      tone: 'neutral',
    },
  ], [status]);

  const handleUnlockDoor = useCallback(async () => {
    setDoorLoading(true);
    try {
      await api.unlockDoor();
      setDoorSuccess(true);
      showToast('Đã mở cửa thành công', 'success');
      window.setTimeout(() => setDoorSuccess(false), 3000);
      const nextStatus = await api.getStatus().catch(() => null);
      if (nextStatus) setStatus(nextStatus);
    } catch {
      showToast('Không thể mở cửa, kiểm tra kết nối thiết bị', 'error');
    } finally {
      setDoorLoading(false);
    }
  }, [showToast]);

  const handleAlarm = useCallback(async () => {
    setAlarmLoading(true);
    try {
      const next = !alarmActive;
      await api.triggerAlarm(next);
      setAlarmActive(next);
      showToast(next ? 'Đã bật báo động' : 'Đã tắt báo động', next ? 'warn' : 'success');
    } catch {
      showToast('Không thể thay đổi trạng thái báo động', 'error');
    } finally {
      setAlarmLoading(false);
    }
  }, [alarmActive, showToast]);

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
          {toast.kind === 'error' && <BlockFilledIcon size={16} />}
          {toast.kind === 'warn' && <AlarmOnFilledIcon size={16} />}
          {toast.msg}
        </div>
      )}

      <header className="page-header">
        <div>
          <p className="eyebrow">{formatDate()}</p>
          <h1 className="text-heading-1">{getGreeting()}, {user?.first_name || 'Quản trị viên'}</h1>
        </div>
        <span className={`connection-chip ${status?.mqttConnected ? 'is-online' : 'is-offline'}`}>
          <WifiFilledIcon size={15} />
          {status?.mqttConnected ? 'Đang kết nối' : 'Mất kết nối'}
        </span>
      </header>

      <section className="dashboard-shell">
        <div className="control-column">
          <div className={`security-hero ${alarmActive ? 'is-alerting' : ''}`}>
            <div className="security-hero-main">
              <div className="security-mark">
                <ShieldFilledIcon size={42} />
              </div>
              <div>
                <span className="eyebrow">Trạng thái hệ thống</span>
                <h2>{alarmActive ? 'Đang báo động' : status?.mqttConnected ? 'An toàn' : 'Cần kiểm tra'}</h2>
                <p>
                  {status?.lastUpdate
                    ? `Cập nhật ${formatTimeAgo(status.lastUpdate)}`
                    : isLoading ? 'Đang đồng bộ dữ liệu thiết bị' : 'Chưa có tín hiệu cập nhật'}
                </p>
              </div>
            </div>

            <div className="stat-grid">
              {stats.map((item) => (
                <div className="stat-tile" data-tone={item.tone} key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="quick-actions">
            <button
              className={`action-button ${doorSuccess ? 'is-success' : ''}`}
              onClick={handleUnlockDoor}
              disabled={doorLoading}
              id="btn-unlock-door"
            >
              {doorLoading ? (
                <div className="loading-spinner" />
              ) : doorSuccess ? (
                <CheckFilledIcon size={25} />
              ) : (
                <LockOpenFilledIcon size={25} />
              )}
              <span>{doorSuccess ? 'Đã mở' : 'Mở cửa'}</span>
            </button>

            <button
              className={`action-button danger-action ${alarmActive ? 'is-active' : ''}`}
              onClick={handleAlarm}
              disabled={alarmLoading}
              id="btn-alarm"
            >
              {alarmLoading ? (
                <div className="loading-spinner" />
              ) : alarmActive ? (
                <AlarmOffFilledIcon size={25} />
              ) : (
                <AlarmOnFilledIcon size={25} />
              )}
              <span>{alarmActive ? 'Tắt báo động' : 'Bật báo động'}</span>
            </button>
          </div>

          {latestAlert && (
            <Link href="/logs" className="critical-alert">
              <span className="alert-card-icon">{getEventFilledIcon(latestAlert.type, { size: 22 })}</span>
              <span>
                <strong>{latestAlert.title}</strong>
                <small>{latestAlert.description}</small>
              </span>
              <ChevronRightFilledIcon size={20} />
            </Link>
          )}
        </div>

        <div className="camera-panel">
          <div className="camera-card">
            <div className="camera-live-indicator">
              <span className="camera-live-dot" /> LIVE
            </div>
            <div className="camera-badge">
              <span className={`badge badge-pulse ${status?.mqttConnected ? 'badge-success' : 'badge-danger'}`}>
                {status?.mqttConnected ? 'Đang quan sát' : 'Chưa có tín hiệu'}
              </span>
            </div>
            {cameraEvent?.thumbnailUrl ? (
              <Image
                src={cameraEvent.thumbnailUrl}
                alt={cameraEvent.title}
                fill
                sizes="(min-width: 768px) 42vw, 100vw"
                className="camera-feed"
                priority
              />
            ) : (
              <div className="camera-placeholder">
                <ShieldFilledIcon size={42} />
                <span>EdgeGuard Live View</span>
              </div>
            )}
          </div>

          <div className="insight-strip">
            <div>
              <span>AI model</span>
              <strong>{status?.modelLabel || 'normal'}</strong>
            </div>
            <div>
              <span>Anomaly</span>
              <strong>{status?.anomalyScore !== undefined ? `${Math.round(status.anomalyScore * 100)}%` : '--'}</strong>
            </div>
            <div>
              <span>Độ ẩm</span>
              <strong>{status?.humidityPct !== undefined ? `${Math.round(status.humidityPct)}%` : '--'}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="section-heading-row">
        <div>
          <h2 className="text-heading-3">Hoạt động gần đây</h2>
          <p className="text-caption">{recentEvents.length} sự kiện mới nhất</p>
        </div>
        <Link href="/logs" className="inline-link">
          Xem tất cả <ChevronRightFilledIcon size={16} />
        </Link>
      </section>

      <div className="recent-list stagger-children">
        {isLoading ? (
          <div className="empty-state">Đang tải dữ liệu giám sát...</div>
        ) : recentEvents.length === 0 ? (
          <div className="empty-state">Chưa có sự kiện nào được ghi nhận.</div>
        ) : (
          recentEvents.slice(0, 5).map((event) => (
            <Link href="/logs" className="recent-event" key={event.id}>
              <span className={`event-icon event-${event.severity}`}>
                {event.thumbnailUrl ? (
                  <Image
                    src={event.thumbnailUrl}
                    alt={event.title}
                    width={46}
                    height={46}
                    className="event-thumb"
                  />
                ) : (
                  getEventFilledIcon(event.type, { size: 21 })
                )}
              </span>
              <span className="recent-event-copy">
                <strong>{event.title}</strong>
                <small>{event.description}</small>
              </span>
              <span className="recent-event-meta">
                <small>{formatTimeAgo(event.timestamp)}</small>
                {event.aiConfidence && <b>{Math.round(event.aiConfidence * 100)}%</b>}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
