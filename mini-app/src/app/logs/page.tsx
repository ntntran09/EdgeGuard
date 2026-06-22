'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { formatDate, formatTime, formatTimeAgo } from '@/lib/telegram';
import { api } from '@/lib/api';
import { BlockFilledIcon, CheckFilledIcon, getEventFilledIcon } from '@/components/icons/FilledIcons';
import type { SecurityEvent } from '@/types';

type FilterType = 'all' | 'person' | 'object' | 'door' | 'rfid';

const filters: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'person', label: 'Người' },
  { key: 'object', label: 'Vật thể' },
  { key: 'door', label: 'Mở khóa/Cửa' },
  { key: 'rfid', label: 'RFID' },
];

function getSeverityLabel(severity: string) {
  switch (severity) {
    case 'danger': return 'Nguy hiểm';
    case 'warning': return 'Cảnh báo';
    default: return 'Bình thường';
  }
}

function getSeverityBadgeClass(severity: string) {
  switch (severity) {
    case 'danger': return 'badge-danger';
    case 'warning': return 'badge-warning';
    default: return 'badge-success';
  }
}

function canRenderImage(url?: string) {
  if (!url) return false;
  if (url.startsWith('data:image/') || url.startsWith('/')) return true;
  return !url.includes('t.me/');
}

export default function LogsPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(null);
  const [showUnseenOnly, setShowUnseenOnly] = useState(false);
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.resolve().then(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await api.getEvents(activeFilter);
        if (!cancelled) setEvents(res.events || []);
      } catch (err) {
        console.error('Failed to load events', err);
        if (!cancelled) {
          setError('Không thể tải lịch sử sự kiện');
          setEvents([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeFilter]);

  useEffect(() => {
    document.body.style.overflow = selectedEvent ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [selectedEvent]);

  const unseenEvents = useMemo(() => events.filter((event) => !event.isViewed), [events]);
  const visibleEvents = useMemo(() => showUnseenOnly ? unseenEvents : events, [events, showUnseenOnly, unseenEvents]);

  const summary = useMemo(() => {
    const unseenDanger = unseenEvents.filter((event) => event.severity === 'danger').length;
    const unseenWarning = unseenEvents.filter((event) => event.severity === 'warning').length;
    return { unseenDanger, unseenWarning, unseen: unseenEvents.length };
  }, [unseenEvents]);

  const markViewed = async (event: SecurityEvent) => {
    setSelectedEvent(event);
    if (event.isViewed) return;

    setEvents((prev) => prev.map((item) => item.id === event.id ? { ...item, isViewed: true } : item));
    try {
      await api.markEventViewed(event.id);
    } catch (error) {
      console.error('Failed to mark event viewed', error);
    }
  };

  const markAllVisibleViewed = async () => {
    const ids = unseenEvents.map((event) => event.id);
    if (!ids.length) {
      setShowUnseenOnly(false);
      return;
    }

    setMarkAllLoading(true);
    setEvents((prev) => prev.map((event) => ids.includes(event.id) ? { ...event, isViewed: true } : event));
    try {
      await api.markEventsViewed(ids);
      setShowUnseenOnly(false);
    } catch (error) {
      console.error('Failed to mark all events viewed', error);
    } finally {
      setMarkAllLoading(false);
    }
  };

  const renderEventCards = (items: SecurityEvent[]) => (
    <div className="event-grid stagger-children">
      {items.map((event) => {
        const seen = Boolean(event.isViewed);
        return (
          <button
            key={event.id}
            className={`event-card-enhanced ${seen ? 'is-seen' : 'is-unseen'}`}
            id={`event-${event.id}`}
            onClick={() => markViewed(event)}
          >
            <div className="event-card-media">
              {canRenderImage(event.thumbnailUrl) ? (
                <Image
                  src={event.thumbnailUrl!}
                  alt={event.title}
                  width={520}
                  height={292}
                  className="event-card-img"
                  priority={event.id === events[0]?.id}
                />
              ) : (
                <div className="event-card-image-placeholder">
                  {getEventFilledIcon(event.type, { size: 34 })}
                </div>
              )}
              <div className="event-card-image-overlay">
                <span className={`badge ${getSeverityBadgeClass(event.severity)}`}>
                  {getSeverityLabel(event.severity)}
                </span>
                {!seen && <span className="badge badge-info event-new-badge">Mới</span>}
                {event.aiConfidence && (
                  <span className="event-confidence dark-confidence">
                    AI {Math.round(event.aiConfidence * 100)}%
                  </span>
                )}
              </div>
              <div className="event-card-timestamp-overlay">{formatTime(event.timestamp)}</div>
            </div>

            <div className="event-card-info">
              <div className="event-title-row">
                <span className={`event-icon event-${event.severity}`}>
                  {getEventFilledIcon(event.type, { size: 20 })}
                </span>
                <div>
                  <strong>{event.title}</strong>
                  <small>{event.description}</small>
                </div>
              </div>
              <span className="text-caption">{formatTimeAgo(event.timestamp)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="logs-page">
      <header className="page-header logs-page-header">
        <div>
          <p className="eyebrow">Nhật ký an ninh</p>
          <h1 className="text-heading-1">Lịch sử sự kiện</h1>
        </div>
      </header>

      <section className="logs-controls-panel">
        <div className="logs-filter-row">
          <div className="segmented-control" id="filter-tags">
            {filters.map((filter) => (
              <button
                key={filter.key}
                className={activeFilter === filter.key ? 'active' : ''}
                onClick={() => setActiveFilter(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="event-count-row">
          <span className="text-caption logs-count-label">{visibleEvents.length}/{events.length} sự kiện</span>
          <div className="event-view-controls">
            <button
              className={`mini-btn ${showUnseenOnly ? 'active' : ''}`}
              onClick={() => setShowUnseenOnly((current) => !current)}
            >
              Sự kiện mới
            </button>
            {showUnseenOnly && (
              <button className="mini-btn" onClick={markAllVisibleViewed} disabled={markAllLoading}>
                {markAllLoading ? 'Đang lưu...' : 'Xem tất cả'}
              </button>
            )}
          </div>
          <div className="summary-pills">
            <span className="badge badge-info">{summary.unseen} chưa xem</span>
            <span className="badge badge-danger">{summary.unseenDanger} nguy hiểm</span>
            <span className="badge badge-warning">{summary.unseenWarning} cảnh báo</span>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="empty-state">Đang tải dữ liệu...</div>
      ) : error ? (
        <div className="empty-state is-error">{error}</div>
      ) : events.length === 0 ? (
        <div className="empty-state">Chưa có sự kiện nào trong nhóm này.</div>
      ) : visibleEvents.length === 0 ? (
        <div className="empty-state">Không còn sự kiện mới trong nhóm này.</div>
      ) : (
        renderEventCards(visibleEvents)
      )}

      {selectedEvent && (
        <div className="modal-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="modal-content detail-modal" onClick={(e) => e.stopPropagation()}>
            {canRenderImage(selectedEvent.thumbnailUrl) && (
              <div className="detail-modal-media">
                <Image
                  src={selectedEvent.thumbnailUrl!}
                  alt={selectedEvent.title}
                  fill
                  sizes="(min-width: 768px) 420px, 100vw"
                  className="event-card-img"
                />
                <button className="icon-close-btn" onClick={() => setSelectedEvent(null)} aria-label="Đóng">
                  <BlockFilledIcon size={18} />
                </button>
              </div>
            )}

            <div className="detail-modal-body">
              <div className="detail-modal-heading">
                <span className={`event-icon event-${selectedEvent.severity}`}>
                  {getEventFilledIcon(selectedEvent.type, { size: 24 })}
                </span>
                <div>
                  <h2>{selectedEvent.title}</h2>
                  <p>{selectedEvent.description}</p>
                </div>
              </div>

              <div className="detail-list">
                <div>
                  <span>Thời gian</span>
                  <strong>{formatTime(selectedEvent.timestamp)}, {formatDate(new Date(selectedEvent.timestamp))}</strong>
                </div>
                <div>
                  <span>Mức độ</span>
                  <strong>{getSeverityLabel(selectedEvent.severity)}</strong>
                </div>
                {selectedEvent.aiConfidence && (
                  <div>
                    <span>Độ tin cậy AI</span>
                    <strong>{Math.round(selectedEvent.aiConfidence * 100)}%</strong>
                  </div>
                )}
                {selectedEvent.cardId && (
                  <div>
                    <span>Mã thẻ</span>
                    <strong>{selectedEvent.cardId}</strong>
                  </div>
                )}
              </div>

              <button className="pill-btn pill-btn-primary" onClick={() => setSelectedEvent(null)}>
                <CheckFilledIcon size={18} /> Đã xem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
