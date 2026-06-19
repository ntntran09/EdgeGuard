'use client';

import { useState, useCallback, useRef } from 'react';
import { mockCards, defaultAlertConfig } from '@/lib/mock-data';
import { formatTimeAgo } from '@/lib/telegram';
import { api } from '@/lib/api';
import type { RfidCard, AlertConfig } from '@/types';

const TIME_OPTIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1 phút' },
  { value: 120, label: '2 phút' },
  { value: 300, label: '5 phút' },
  { value: 600, label: '10 phút' },
];

interface SwipeableCardProps {
  card: RfidCard;
  onDelete: (id: string) => void;
}

function SwipeableRfidCard({ card, onDelete }: SwipeableCardProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const startXRef = useRef(0);
  const isDraggingRef = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    isDraggingRef.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    const diff = startXRef.current - e.touches[0].clientX;
    if (isOpen) {
      setOffsetX(Math.max(0, Math.min(80, 80 - diff * -1)));
    } else {
      setOffsetX(Math.max(0, Math.min(80, diff)));
    }
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    if (offsetX > 40) {
      setOffsetX(80);
      setIsOpen(true);
    } else {
      setOffsetX(0);
      setIsOpen(false);
    }
  };

  return (
    <div className="rfid-item">
      <div className="rfid-item-actions">
        <button
          className="rfid-delete-btn"
          onClick={() => onDelete(card.id)}
        >
          Vô hiệu hóa
        </button>
      </div>
      <div
        className="rfid-item-content"
        style={{ transform: `translateX(-${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="rfid-icon">💳</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '2px' }}>
            {card.name}
          </div>
          <div className="text-caption" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
            {card.cardUid}
          </div>
          {card.lastUsedAt && (
            <div className="text-caption" style={{ marginTop: '2px', fontSize: '0.7rem' }}>
              Sử dụng cuối: {formatTimeAgo(card.lastUsedAt)}
            </div>
          )}
        </div>
        <span className={`badge ${card.isActive ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.65rem' }}>
          {card.isActive ? 'Hoạt động' : 'Đã vô hiệu'}
        </span>
        {/* Desktop delete button */}
        <button
          className="rfid-delete-btn"
          style={{
            display: 'none',
            padding: '6px 12px',
            fontSize: '0.7rem',
          }}
          onClick={() => onDelete(card.id)}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.display = 'block'; }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [cards, setCards] = useState<RfidCard[]>(mockCards.filter(c => c.isActive));
  const [alertConfig, setAlertConfig] = useState<AlertConfig>(defaultAlertConfig);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCardUid, setNewCardUid] = useState('');
  const [newCardName, setNewCardName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleDeleteCard = useCallback((id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    showToast('✅ Đã vô hiệu hóa thẻ');
  }, []);

  const handleAddCard = useCallback(async () => {
    if (!newCardUid.trim() || !newCardName.trim()) {
      showToast('❌ Vui lòng nhập đầy đủ thông tin');
      return;
    }
    setAddLoading(true);
    try {
      const newCard: RfidCard = {
        id: `card-${Date.now()}`,
        cardUid: newCardUid.trim(),
        name: newCardName.trim(),
        isActive: true,
        addedAt: new Date().toISOString(),
      };
      setCards(prev => [...prev, newCard]);
      setShowAddModal(false);
      setNewCardUid('');
      setNewCardName('');
      showToast('✅ Đã thêm thẻ mới');
    } catch {
      showToast('❌ Không thể thêm thẻ');
    } finally {
      setAddLoading(false);
    }
  }, [newCardUid, newCardName]);

  const getTimeOptionIndex = () => {
    const idx = TIME_OPTIONS.findIndex(o => o.value === alertConfig.objectLeftMaxSeconds);
    return idx >= 0 ? idx : 1;
  };

  const handleSliderChange = (index: number) => {
    setAlertConfig(prev => ({
      ...prev,
      objectLeftMaxSeconds: TIME_OPTIONS[index].value,
    }));
  };

  return (
    <div className="animate-fade-in">
      {toast && <div className="toast">{toast}</div>}

      {/* Page Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 className="text-heading-1" style={{ margin: 0 }}>Cài đặt</h1>
        <p className="text-caption" style={{ margin: '6px 0 0' }}>
          Quản lý thẻ RFID và cấu hình cảnh báo AI
        </p>
      </div>

      {/* Section: RFID Cards */}
      <div style={{ marginBottom: '32px' }}>
        <h2 className="text-heading-3" style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          💳 Thẻ RFID/NFC
          <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>{cards.length} thẻ</span>
        </h2>
        <p className="text-caption" style={{ margin: '0 0 12px', display: 'block' }}>
          ← Vuốt trái để vô hiệu hóa thẻ trên điện thoại
        </p>

        <div>
          {cards.map(card => (
            <SwipeableRfidCard key={card.id} card={card} onDelete={handleDeleteCard} />
          ))}
          {cards.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--hint)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>💳</div>
              <p>Chưa có thẻ nào. Nhấn + để thêm thẻ mới.</p>
            </div>
          )}
        </div>
      </div>

      {/* Section: AI Alert Config */}
      <div style={{ marginBottom: '32px' }}>
        <h2 className="text-heading-3" style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🤖 Cấu hình cảnh báo AI
        </h2>

        {/* Object Left Timer */}
        <div className="card" style={{ padding: '20px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>⏱️ Thời gian vật thể bỏ lại</span>
            <span className="badge badge-info">{TIME_OPTIONS[getTimeOptionIndex()].label}</span>
          </div>
          <p className="text-caption" style={{ margin: '0 0 16px' }}>
            Thời gian tối đa trước khi báo động khi phát hiện vật thể bị bỏ lại
          </p>
          {/* Slider buttons */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {TIME_OPTIONS.map((option, index) => (
              <button
                key={option.value}
                className={`filter-tag ${getTimeOptionIndex() === index ? 'active' : ''}`}
                onClick={() => handleSliderChange(index)}
                style={{ minWidth: '56px', justifyContent: 'center' }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stranger Alert Toggle */}
        <div className="card" style={{ padding: '20px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>👤 Cảnh báo người lạ</span>
              <p className="text-caption" style={{ margin: '4px 0 0' }}>Cảnh báo khi AI phát hiện người không xác định</p>
            </div>
            <button
              onClick={() => setAlertConfig(prev => ({ ...prev, strangerAlertEnabled: !prev.strangerAlertEnabled }))}
              style={{
                width: '52px',
                height: '28px',
                borderRadius: '14px',
                border: 'none',
                background: alertConfig.strangerAlertEnabled ? 'var(--gradient-primary)' : 'var(--secondary-bg)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.3s',
              }}
            >
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: 'white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                  position: 'absolute',
                  top: '3px',
                  left: alertConfig.strangerAlertEnabled ? '27px' : '3px',
                  transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </button>
          </div>
        </div>

        {/* Camera Blocked Alert Toggle */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>📷 Cảnh báo camera bị che</span>
              <p className="text-caption" style={{ margin: '4px 0 0' }}>Cảnh báo khi camera bị che hoặc mờ</p>
            </div>
            <button
              onClick={() => setAlertConfig(prev => ({ ...prev, cameraBlockedAlertEnabled: !prev.cameraBlockedAlertEnabled }))}
              style={{
                width: '52px',
                height: '28px',
                borderRadius: '14px',
                border: 'none',
                background: alertConfig.cameraBlockedAlertEnabled ? 'var(--gradient-primary)' : 'var(--secondary-bg)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.3s',
              }}
            >
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: 'white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                  position: 'absolute',
                  top: '3px',
                  left: alertConfig.cameraBlockedAlertEnabled ? '27px' : '3px',
                  transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* FAB - Add Card */}
      <button
        className="fab"
        onClick={() => setShowAddModal(true)}
        id="fab-add-card"
        aria-label="Thêm thẻ mới"
      >
        +
      </button>

      {/* Add Card Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h3 className="text-heading-3" style={{ margin: '0 0 20px' }}>Thêm thẻ RFID mới</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontWeight: 500, fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>
                  Mã thẻ (UID)
                </label>
                <input
                  type="text"
                  value={newCardUid}
                  onChange={(e) => setNewCardUid(e.target.value)}
                  placeholder="VD: A3:F2:8B:01"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: '1.5px solid rgba(0,0,0,0.1)',
                    background: 'var(--secondary-bg)',
                    color: 'var(--text)',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--accent-primary)'; }}
                  onBlur={(e) => { e.target.style.borderColor = 'rgba(0,0,0,0.1)'; }}
                  id="input-card-uid"
                />
              </div>

              <div>
                <label style={{ fontWeight: 500, fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>
                  Tên chủ thẻ
                </label>
                <input
                  type="text"
                  value={newCardName}
                  onChange={(e) => setNewCardName(e.target.value)}
                  placeholder="VD: Nguyễn Văn A"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: '1.5px solid rgba(0,0,0,0.1)',
                    background: 'var(--secondary-bg)',
                    color: 'var(--text)',
                    fontSize: '0.9rem',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--accent-primary)'; }}
                  onBlur={(e) => { e.target.style.borderColor = 'rgba(0,0,0,0.1)'; }}
                  id="input-card-name"
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button
                  className="pill-btn pill-btn-secondary"
                  onClick={() => setShowAddModal(false)}
                  style={{ flex: 1 }}
                >
                  Hủy
                </button>
                <button
                  className="pill-btn pill-btn-primary"
                  onClick={handleAddCard}
                  disabled={addLoading}
                  style={{ flex: 1 }}
                  id="btn-add-card"
                >
                  {addLoading ? (
                    <div className="loading-spinner" />
                  ) : (
                    'Thêm thẻ'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
