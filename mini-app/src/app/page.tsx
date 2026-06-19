'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTelegram } from '@/hooks/useTelegram';
import { getGreeting, formatDate, formatTimeAgo } from '@/lib/telegram';
import {
  LockOpenFilledIcon,
  AlarmOnFilledIcon, AlarmOffFilledIcon,
  CheckFilledIcon, BlockFilledIcon,
  ShieldFilledIcon, WifiFilledIcon,
  BellFilledIcon, ChevronRightFilledIcon,
  getEventFilledIcon,
} from '@/components/icons/FilledIcons';
import { api } from '@/lib/api';
import { mockEvents } from '@/lib/mock-data';
import type { SecurityEvent } from '@/types';
import Link from 'next/link';
import Image from 'next/image';

export default function DashboardPage() {
  const { user } = useTelegram();

  const [doorLoading, setDoorLoading] = useState(false);
  const [alarmLoading, setAlarmLoading] = useState(false);
  const [doorSuccess, setDoorSuccess] = useState(false);
  const [alarmActive, setAlarmActive] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | 'warn' } | null>(null);
  const [recentEvents] = useState<SecurityEvent[]>(mockEvents.slice(0, 5));
  const [cameraOnline] = useState(true);

  // Auto-clear toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const showToast = (msg: string, kind: 'success' | 'error' | 'warn' = 'success') =>
    setToast({ msg, kind });

  const handleUnlockDoor = useCallback(async () => {
    setDoorLoading(true);
    try {
      await api.unlockDoor();
      setDoorSuccess(true);
      showToast('Đã mở cửa thành công', 'success');
      setTimeout(() => {
        setDoorSuccess(false);
      }, 3000);
    } catch {
      showToast('Không thể mở cửa, kiểm tra kết nối', 'error');
    } finally {
      setDoorLoading(false);
    }
  }, []);

  const handleAlarm = useCallback(async () => {
    setAlarmLoading(true);
    try {
      const next = !alarmActive;
      await api.triggerAlarm(next);
      setAlarmActive(next);
      if (next) {
        showToast('Đã kích hoạt báo động', 'warn');
      } else {
        showToast('Đã tắt báo động', 'success');
      }
    } catch {
      showToast('Lỗi kích hoạt báo động', 'error');
    } finally {
      setAlarmLoading(false);
    }
  }, [alarmActive]);

  const latestAlert = recentEvents.find(e => e.severity === 'danger' || e.severity === 'warning');

  const toastBg: Record<string, string> = {
    success: 'var(--accent-success)',
    error: 'var(--accent-danger)',
    warn: 'var(--accent-warning)',
  };

  return (
    <div>
      {/* ── Toast ── */}
      {toast && (
        <div className="toast" style={{ background: toastBg[toast.kind] }}>
          {toast.kind === 'success' && <CheckFilledIcon size={16} />}
          {toast.kind === 'error' && <BlockFilledIcon size={16} />}
          {toast.kind === 'warn' && <AlarmOnFilledIcon size={16} />}
          {toast.msg}
        </div>
      )}

      <header className="dashboard-header">
        <div>
          <p className="text-caption" style={{ margin: '0 0 2px', opacity: 0.75 }}>{formatDate()}</p>
          <h1 className="text-heading-1" style={{ margin: 0, lineHeight: 1.1 }}>{getGreeting()},</h1>
          <h2 className="text-heading-2" style={{ margin: '2px 0 0', fontWeight: 700 }}>
            {user?.first_name || 'Quản trị viên'}
          </h2>
        </div>
      </header>

      <div className="dashboard-grid" style={{ marginTop: '16px' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          {/* SYSTEM STATUS BENTO CARD */}
          <div className="bento-card system-status-card">
            <div className="status-indicator">
              <div className={`status-ring ${alarmActive ? 'ring-danger' : 'ring-success'}`}>
                <ShieldFilledIcon size={48} className={`status-shield ${alarmActive ? 'text-danger' : 'text-success'}`} />
              </div>
            </div>
            <div className="status-details">
              <h3 style={{ margin: '0 0 4px', fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>
                {alarmActive ? 'HỆ THỐNG CẢNH BÁO' : 'HỆ THỐNG AN TOÀN'}
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <WifiFilledIcon size={14} /> Trực tuyến • Mọi cảm biến hoạt động tốt
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="quick-actions" id="quick-actions">
            {/* Mở cửa */}
            <button
              className="quick-action-btn"
              style={{
                background: doorSuccess
                  ? 'linear-gradient(135deg, #1a9460 0%, #27ae72 100%)'
                  : 'var(--gradient-card)',
                boxShadow: doorSuccess ? '0 4px 14px rgba(15,127,95,0.32)' : 'var(--shadow-card)',
                color: doorSuccess ? 'white' : 'var(--text)',
                border: '1px solid rgba(150, 150, 150, 0.1)'
              }}
              onClick={handleUnlockDoor}
              disabled={doorLoading}
              id="btn-unlock-door"
            >
              {doorLoading ? (
                <div className="loading-spinner" style={{ borderColor: 'var(--hint)', borderTopColor: 'var(--accent-primary)' }} />
              ) : doorSuccess ? (
                <span className="quick-action-icon success-icon"><CheckFilledIcon size={28} /></span>
              ) : (
                <span className="quick-action-icon" style={{ color: 'var(--accent-primary)' }}><LockOpenFilledIcon size={28} /></span>
              )}
              <span>{doorSuccess ? 'Đã mở!' : 'Mở cửa'}</span>
            </button>

            {/* Báo động */}
            <button
              className="quick-action-btn"
              style={{
                background: alarmActive
                  ? 'linear-gradient(135deg, #c0392b 0%, #e84545 100%)'
                  : 'var(--gradient-card)',
                boxShadow: alarmActive
                  ? '0 4px 14px rgba(192,57,43,0.35)'
                  : 'var(--shadow-card)',
                color: alarmActive ? 'white' : 'var(--text)',
                border: '1px solid rgba(150, 150, 150, 0.1)',
                animation: alarmActive ? 'alarm-active-glow 1.2s ease infinite' : undefined,
              }}
              onClick={handleAlarm}
              disabled={alarmLoading}
              id="btn-alarm"
            >
              {alarmLoading ? (
                <div className="loading-spinner" style={{ borderColor: 'var(--hint)', borderTopColor: 'var(--accent-danger)' }} />
              ) : alarmActive ? (
                <span className="quick-action-icon" style={{ animation: 'shake 0.4s ease infinite' }}>
                  <AlarmOffFilledIcon size={28} />
                </span>
              ) : (
                <span className="quick-action-icon" style={{ color: 'var(--accent-danger)' }}><AlarmOnFilledIcon size={28} /></span>
              )}
              <span>{alarmActive ? 'Tắt báo động' : 'Báo động'}</span>
            </button>
          </div>

          {/* Camera feed */}
          <div className="camera-card" id="camera-feed" style={{ borderRadius: '10px' }}>
            <div className="camera-live-indicator">
              <span className="camera-live-dot" /> LIVE
            </div>
            <div className="camera-badge">
              <span className={`badge badge-pulse ${cameraOnline ? 'badge-success' : 'badge-danger'}`}>
                {cameraOnline ? 'Đang quan sát' : 'Camera bị che'}
              </span>
            </div>
            <div className="camera-placeholder">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>Live View</span>
            </div>
          </div>

        </div>

        {/* Right Column: Recent Events */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* Latest alert card highlight */}
          {latestAlert && (
            <Link href="/logs" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="alert-card bento-card" id="recent-alert" style={{ background: 'var(--gradient-card)' }}>
                <div className="alert-card-icon" style={{ background: 'rgba(232, 69, 69, 0.1)', color: 'var(--accent-danger)' }}>
                  {getEventFilledIcon(latestAlert.type, { size: 22 })}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '2px' }}>{latestAlert.title}</div>
                  <div className="text-caption" style={{ color: 'var(--text)' }}>{latestAlert.description}</div>
                  <div className="text-caption" style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{formatTimeAgo(latestAlert.timestamp)}</span>
                    {latestAlert.aiConfidence && (
                      <span className="event-confidence">AI {Math.round(latestAlert.aiConfidence * 100)}%</span>
                    )}
                  </div>
                </div>
                <ChevronRightFilledIcon size={20} style={{ color: 'var(--hint)', flexShrink: 0 }} />
              </div>
            </Link>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
            <h3 className="text-heading-3" style={{ margin: 0 }}>Lịch sử hoạt động</h3>
            <Link href="/logs" style={{ color: 'var(--link)', fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '2px' }}>
              Xem tất cả <ChevronRightFilledIcon size={16} />
            </Link>
          </div>

          <div className="stagger-children bento-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' }}>
            {recentEvents.map((event, i) => (
              <div key={event.id} style={{ borderBottom: i < recentEvents.length - 1 ? '1px solid rgba(150,150,150,0.1)' : 'none', paddingBottom: i < recentEvents.length - 1 ? '12px' : '0' }}>
                <div className="event-item" style={{ background: 'transparent', boxShadow: 'none', padding: 0 }}>
                  <div className="event-thumbnail" style={{ width: 44, height: 44 }}>
                    {event.thumbnailUrl ? (
                      <Image
                        src={event.thumbnailUrl}
                        alt={event.title}
                        width={44}
                        height={44}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }}
                      />
                    ) : (
                      getEventFilledIcon(event.type, { size: 20 })
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '1px' }}>{event.title}</div>
                    <div className="text-caption" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {event.description}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    <span className="text-caption" style={{ fontSize: '0.68rem' }}>{formatTimeAgo(event.timestamp)}</span>
                    {event.aiConfidence && (
                      <span className="event-confidence">{Math.round(event.aiConfidence * 100)}%</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
