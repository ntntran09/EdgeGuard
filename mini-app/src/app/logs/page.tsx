'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { mockEvents } from '@/lib/mock-data';
import { formatTimeAgo, formatTime, formatDate } from '@/lib/telegram';
import { getEventFilledIcon } from '@/components/icons/FilledIcons';
import type { SecurityEvent } from '@/types';

type FilterType = 'all' | 'ai' | 'rfid';

const filters: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'ai', label: 'Cảnh báo AI' },
  { key: 'rfid', label: 'Truy cập RFID' },
];

function filterEvents(events: SecurityEvent[], filter: FilterType): SecurityEvent[] {
  if (filter === 'all') return events;
  if (filter === 'ai') {
    return events.filter(e => ['stranger_detected', 'object_left', 'camera_blocked'].includes(e.type));
  }
  if (filter === 'rfid') {
    return events.filter(e => ['access_granted', 'access_denied', 'rfid_scan'].includes(e.type));
  }
  return events;
}

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

export default function LogsPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [events] = useState<SecurityEvent[]>(mockEvents);
  const [filteredEvents, setFilteredEvents] = useState<SecurityEvent[]>(mockEvents);
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(null);

  useEffect(() => {
    setFilteredEvents(filterEvents(events, activeFilter));
  }, [activeFilter, events]);

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '20px' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 className="text-heading-1" style={{ margin: 0 }}>Lịch sử sự kiện</h1>
        <p className="text-caption" style={{ margin: '6px 0 0' }}>
          {events.length} sự kiện được ghi nhận
        </p>
      </div>

      {/* Filter Tags */}
      <div
        id="filter-tags"
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '20px',
          overflowX: 'auto',
          paddingBottom: '4px',
          scrollbarWidth: 'none',
        }}
      >
        {filters.map((filter) => (
          <button
            key={filter.key}
            className={`filter-tag ${activeFilter === filter.key ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Event List */}
      <div className="stagger-children" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredEvents.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--hint)',
          }}>
            <div style={{ marginBottom: '12px', color: 'var(--accent-primary)', opacity: 0.5 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
              </svg>
            </div>
            <p style={{ fontWeight: 500 }}>Không có sự kiện nào</p>
            <p className="text-caption">Thử thay đổi bộ lọc để xem thêm</p>
          </div>
        ) : (
          filteredEvents.map((event) => (
            <div 
              key={event.id} 
              className="event-card-enhanced" 
              id={`event-${event.id}`}
              onClick={() => setSelectedEvent(event)}
            >
              {/* Image Section */}
              <div className="event-card-image">
                {event.thumbnailUrl ? (
                  <Image
                    src={event.thumbnailUrl}
                    alt={event.title}
                    width={400}
                    height={200}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    priority={event.id === '1'}
                  />
                ) : (
                  <div className="event-card-image-placeholder">
                    <span style={{ color: 'var(--accent-primary)' }}>{getEventFilledIcon(event.type, { size: 48 })}</span>
                  </div>
                )}
                {/* Overlay badges on image */}
                <div className="event-card-image-overlay">
                  <span className={`badge ${getSeverityBadgeClass(event.severity)}`}>
                    {getSeverityLabel(event.severity)}
                  </span>
                  {event.aiConfidence && (
                    <span className="event-confidence" style={{ background: 'rgba(0,0,0,0.5)', color: 'white', backdropFilter: 'blur(4px)' }}>
                      AI {Math.round(event.aiConfidence * 100)}%
                    </span>
                  )}
                </div>
                {/* Time stamp on image */}
                <div className="event-card-timestamp-overlay">
                  <span>{formatTime(event.timestamp)}</span>
                </div>
              </div>

              {/* Info Section */}
              <div className="event-card-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: 'var(--accent-primary)' }}>{getEventFilledIcon(event.type, { size: 24 })}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {event.title}
                    </div>
                    <div className="text-caption" style={{ marginTop: '2px' }}>
                      {event.description}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span className="text-caption" style={{ fontSize: '0.75rem', display: 'block' }}>
                      {formatTimeAgo(event.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pop-up Modal */}
      {selectedEvent && (
        <div 
          className="modal-overlay" 
          onClick={() => setSelectedEvent(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            animation: 'fade-in 0.2s ease-out'
          }}
        >
          <div 
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg)',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '400px',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              animation: 'slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            {/* Modal Image */}
            <div style={{ position: 'relative', width: '100%', height: '220px', background: '#1a1a2e' }}>
              {selectedEvent.thumbnailUrl ? (
                <Image
                  src={selectedEvent.thumbnailUrl}
                  alt={selectedEvent.title}
                  fill
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: 'var(--accent-primary)' }}>{getEventFilledIcon(selectedEvent.type, { size: 64 })}</span>
                </div>
              )}
              <div style={{ position: 'absolute', top: 12, right: 12 }}>
                <span className={`badge ${getSeverityBadgeClass(selectedEvent.severity)}`}>
                  {getSeverityLabel(selectedEvent.severity)}
                </span>
              </div>
              <button 
                onClick={() => setSelectedEvent(null)}
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  background: 'rgba(0,0,0,0.5)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  backdropFilter: 'blur(4px)'
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                <div style={{ 
                  background: 'var(--secondary-bg)', 
                  padding: '12px', 
                  borderRadius: '16px',
                  color: 'var(--accent-primary)'
                }}>
                  {getEventFilledIcon(selectedEvent.type, { size: 28 })}
                </div>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: '1.2rem', color: 'var(--text)' }}>
                    {selectedEvent.title}
                  </h2>
                  <p className="text-caption" style={{ margin: 0, fontSize: '0.85rem' }}>
                    {selectedEvent.description}
                  </p>
                </div>
              </div>

              <div style={{ background: 'var(--secondary-bg)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span className="text-caption">Thời gian</span>
                  <span style={{ fontWeight: 500, color: 'var(--text)' }}>
                    {formatTime(selectedEvent.timestamp)}, {formatDate(new Date(selectedEvent.timestamp))}
                  </span>
                </div>
                {selectedEvent.aiConfidence && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span className="text-caption">Độ tin cậy AI</span>
                    <span style={{ fontWeight: 500, color: 'var(--text)' }}>
                      {Math.round(selectedEvent.aiConfidence * 100)}%
                    </span>
                  </div>
                )}
                {selectedEvent.cardId && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-caption">Mã thẻ</span>
                    <span style={{ fontWeight: 500, color: 'var(--accent-primary)' }}>
                      {selectedEvent.cardId}
                    </span>
                  </div>
                )}
              </div>

              <button 
                className="btn-primary" 
                style={{ width: '100%', padding: '14px', borderRadius: '12px' }}
                onClick={() => setSelectedEvent(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
