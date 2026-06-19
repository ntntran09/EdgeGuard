'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatTimeAgo } from '@/lib/telegram';
import { api } from '@/lib/api';
import {
  AlarmOnFilledIcon,
  BlockFilledIcon,
  CreditCardFilledIcon,
  SettingsFilledIcon,
} from '@/components/icons/FilledIcons';
import type { AlertConfig, RfidCard } from '@/types';

const TIME_OPTIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1 phút' },
  { value: 120, label: '2 phút' },
  { value: 300, label: '5 phút' },
  { value: 600, label: '10 phút' },
];

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
}

function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <button
      className={`toggle-switch ${checked ? 'is-on' : ''}`}
      onClick={onChange}
      aria-label={label}
      aria-pressed={checked}
    >
      <span />
    </button>
  );
}

interface RfidCardRowProps {
  card: RfidCard;
  onDelete: (id: string) => void;
  onEdit: (card: RfidCard) => void;
  onToggleActive: (id: string, currentStatus: boolean) => void;
}

function RfidCardRow({ card, onDelete, onEdit, onToggleActive }: RfidCardRowProps) {
  return (
    <div className="rfid-card-row">
      <div className="rfid-icon">
        <CreditCardFilledIcon size={22} />
      </div>
      <div className="rfid-card-copy">
        <div>
          <strong>{card.name}</strong>
          <span className={`badge ${card.isActive ? 'badge-success' : 'badge-danger'}`}>
            {card.isActive ? 'Hoạt động' : 'Đã tắt'}
          </span>
        </div>
        <small>{card.cardUid}</small>
        {card.lastUsedAt && <small>Sử dụng {formatTimeAgo(card.lastUsedAt)}</small>}
      </div>
      <div className="row-actions">
        <button className="mini-btn" onClick={() => onEdit(card)}>Sửa</button>
        <button className="mini-btn" onClick={() => onToggleActive(card.id, card.isActive)}>
          {card.isActive ? 'Tắt' : 'Bật'}
        </button>
        <button className="mini-btn danger" onClick={() => onDelete(card.id)}>Xóa</button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [cards, setCards] = useState<RfidCard[]>([]);
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    objectLeftMaxSeconds: 60,
    strangerAlertEnabled: false,
    cameraBlockedAlertEnabled: true,
    masterKeyEnabled: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editCardData, setEditCardData] = useState<RfidCard | null>(null);
  const [warningModal, setWarningModal] = useState<{ type: 'delete' | 'inactivate'; id: string; extra?: boolean } | null>(null);
  const [formUid, setFormUid] = useState('');
  const [formName, setFormName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [lastCheckedTime, setLastCheckedTime] = useState(() => Date.now());
  const [newScannedUid, setNewScannedUid] = useState<string | null>(null);

  const activeCards = useMemo(() => cards.filter((card) => card.isActive).length, [cards]);

  useEffect(() => {
    Promise.all([api.getCards(), api.getSettings()])
      .then(([cardsRes, settingsRes]) => {
        setCards(cardsRes.cards || []);
        if (settingsRes.settings) setAlertConfig(settingsRes.settings);
      })
      .catch((err) => console.error('Failed to load settings', err))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    if (alertConfig.masterKeyEnabled && !newScannedUid) {
      interval = setInterval(async () => {
        try {
          const res = await api.getEvents('rfid');
          const recentEvent = res.events?.find((event) => {
            const eventTime = new Date(event.timestamp).getTime();
            return eventTime > lastCheckedTime &&
              (event.type === 'rfid_invalid' || event.type === 'access_denied' || event.description.includes('RFID'));
          });

          if (!recentEvent) return;

          setLastCheckedTime(new Date(recentEvent.timestamp).getTime());
          const uidMatch = recentEvent.description.match(/([A-Fa-f0-9]{2}:){3,}[A-Fa-f0-9]{2}/) ||
            recentEvent.description.match(/[A-Fa-f0-9]{8,}/);
          const uid = uidMatch ? uidMatch[0] : recentEvent.cardId;

          if (uid) setNewScannedUid(uid);
        } catch (err) {
          console.error('Polling error', err);
        }
      }, 3000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [alertConfig.masterKeyEnabled, lastCheckedTime, newScannedUid]);

  useEffect(() => {
    const hasModal = showAddModal || editCardData || warningModal || newScannedUid;
    document.body.style.overflow = hasModal ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showAddModal, editCardData, warningModal, newScannedUid]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const closeCardModal = () => {
    setShowAddModal(false);
    setEditCardData(null);
    setFormUid('');
    setFormName('');
  };

  const openAddModal = () => {
    setFormUid('');
    setFormName('');
    setEditCardData(null);
    setShowAddModal(true);
  };

  const openEditModal = (card: RfidCard) => {
    setFormUid(card.cardUid);
    setFormName(card.name);
    setEditCardData(card);
  };

  const updateSetting = async <K extends keyof AlertConfig>(key: K, value: AlertConfig[K]) => {
    setAlertConfig((prev) => ({ ...prev, [key]: value }));
    try {
      await api.updateSettings({ [key]: value });
    } catch {
      showToast('Không thể lưu cài đặt');
    }
  };

  const handleConfirmAction = async () => {
    if (!warningModal) return;
    setActionLoading(true);
    try {
      if (warningModal.type === 'delete') {
        await api.deleteCard(warningModal.id);
        setCards((prev) => prev.filter((card) => card.id !== warningModal.id));
        showToast('Đã xóa thẻ');
      } else {
        const newStatus = !warningModal.extra;
        const res = await api.editCard(warningModal.id, { isActive: newStatus });
        if (res.card) {
          setCards((prev) => prev.map((card) => card.id === warningModal.id ? res.card : card));
          showToast(`Đã ${newStatus ? 'bật' : 'tắt'} thẻ`);
        }
      }
      setWarningModal(null);
    } catch {
      showToast('Có lỗi xảy ra');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveCard = async () => {
    if (!formUid.trim() || !formName.trim()) {
      showToast('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    setActionLoading(true);
    try {
      if (editCardData) {
        const res = await api.editCard(editCardData.id, {
          cardUid: formUid.trim(),
          name: formName.trim(),
        });
        if (res.card) {
          setCards((prev) => prev.map((card) => card.id === res.card.id ? res.card : card));
          closeCardModal();
          showToast('Đã cập nhật thẻ');
        }
      } else {
        const res = await api.addCard(formUid.trim(), formName.trim());
        if (res.card) {
          setCards((prev) => [res.card, ...prev]);
          closeCardModal();
          showToast('Đã thêm thẻ mới');
        }
      }
    } catch {
      showToast('Không thể lưu thẻ');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcceptScannedCard = async () => {
    if (!newScannedUid) return;

    setActionLoading(true);
    try {
      const res = await api.addCard(newScannedUid, 'Thẻ mới');
      if (res.card) {
        setCards((prev) => [res.card, ...prev]);
        setNewScannedUid(null);
        showToast('Đã thêm thẻ mới');
      }
    } catch {
      showToast('Thẻ đã tồn tại hoặc không thể thêm');
    } finally {
      setActionLoading(false);
    }
  };

  const selectedTimeOption = TIME_OPTIONS.find((option) => option.value === alertConfig.objectLeftMaxSeconds) || TIME_OPTIONS[1];

  if (isLoading) {
    return <div className="empty-state">Đang tải cài đặt...</div>;
  }

  return (
    <div className="settings-page">
      {toast && <div className="toast">{toast}</div>}

      <header className="page-header">
        <div>
          <p className="eyebrow">Quản trị thiết bị</p>
          <h1 className="text-heading-1">Cài đặt</h1>
        </div>
        <button className="pill-btn pill-btn-primary" onClick={openAddModal}>
          <CreditCardFilledIcon size={18} /> Thêm thẻ
        </button>
      </header>

      <section className="settings-summary">
        <div className="summary-card">
          <span>Tổng thẻ</span>
          <strong>{cards.length}</strong>
        </div>
        <div className="summary-card">
          <span>Đang hoạt động</span>
          <strong>{activeCards}</strong>
        </div>
        <div className="summary-card">
          <span>Master Key</span>
          <strong>{alertConfig.masterKeyEnabled ? 'Bật' : 'Tắt'}</strong>
        </div>
      </section>

      <section className="settings-layout">
        <div className="settings-panel">
          <div className="panel-heading">
            <div>
              <h2 className="text-heading-3">Thẻ RFID/NFC</h2>
              <p className="text-caption">Danh sách quyền truy cập</p>
            </div>
            <span className="badge badge-info">{cards.length} thẻ</span>
          </div>

          <div className="rfid-list">
            {cards.length === 0 ? (
              <div className="empty-state">Chưa có thẻ nào.</div>
            ) : (
              cards.map((card) => (
                <RfidCardRow
                  key={card.id}
                  card={card}
                  onDelete={(id) => setWarningModal({ type: 'delete', id })}
                  onEdit={openEditModal}
                  onToggleActive={(id, currentStatus) => setWarningModal({ type: 'inactivate', id, extra: currentStatus })}
                />
              ))
            )}
          </div>
        </div>

        <div className="settings-panel">
          <div className="panel-heading">
            <div>
              <h2 className="text-heading-3">Cấu hình hệ thống</h2>
              <p className="text-caption">Cảnh báo AI và RFID</p>
            </div>
            <SettingsFilledIcon size={22} />
          </div>

          <div className="setting-block">
            <div className="setting-block-title">
              <span>Vật thể bị bỏ lại</span>
              <span className="badge badge-info">{selectedTimeOption.label}</span>
            </div>
            <div className="segmented-control segmented-wrap">
              {TIME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={alertConfig.objectLeftMaxSeconds === option.value ? 'active' : ''}
                  onClick={() => updateSetting('objectLeftMaxSeconds', option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-row">
            <div>
              <strong>Cảnh báo người lạ</strong>
              <small>AI phát hiện người chưa xác định</small>
            </div>
            <ToggleSwitch
              checked={alertConfig.strangerAlertEnabled}
              onChange={() => updateSetting('strangerAlertEnabled', !alertConfig.strangerAlertEnabled)}
              label="Cảnh báo người lạ"
            />
          </div>

          <div className="setting-row">
            <div>
              <strong>Camera bị che</strong>
              <small>Cảnh báo khi tầm nhìn bị cản trở</small>
            </div>
            <ToggleSwitch
              checked={alertConfig.cameraBlockedAlertEnabled}
              onChange={() => updateSetting('cameraBlockedAlertEnabled', !alertConfig.cameraBlockedAlertEnabled)}
              label="Cảnh báo camera bị che"
            />
          </div>

          <div className="setting-row">
            <div>
              <strong>Master Key RFID</strong>
              <small>Nhận thẻ mới từ sự kiện quét RFID</small>
            </div>
            <ToggleSwitch
              checked={Boolean(alertConfig.masterKeyEnabled)}
              onChange={() => {
                updateSetting('masterKeyEnabled', !alertConfig.masterKeyEnabled);
                setLastCheckedTime(Date.now());
              }}
              label="Master Key RFID"
            />
          </div>
        </div>
      </section>

      {newScannedUid && (
        <div className="modal-overlay">
          <div className="modal-content compact-modal">
            <div className="modal-icon success">
              <CreditCardFilledIcon size={28} />
            </div>
            <h3>Phát hiện thẻ mới</h3>
            <p><strong>{newScannedUid}</strong></p>
            <div className="modal-actions">
              <button className="pill-btn pill-btn-secondary" onClick={() => setNewScannedUid(null)}>
                Bỏ qua
              </button>
              <button className="pill-btn pill-btn-primary" onClick={handleAcceptScannedCard} disabled={actionLoading}>
                {actionLoading ? <div className="loading-spinner" /> : 'Chấp nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(showAddModal || editCardData) && (
        <div className="modal-overlay" onClick={closeCardModal}>
          <div className="modal-content form-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h3>{editCardData ? 'Sửa thẻ RFID' : 'Thêm thẻ RFID'}</h3>

            <label>
              <span>Mã thẻ UID</span>
              <input
                type="text"
                value={formUid}
                onChange={(e) => setFormUid(e.target.value)}
                placeholder="A3:F2:8B:01"
              />
            </label>

            <label>
              <span>Tên chủ thẻ</span>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nguyễn Văn A"
              />
            </label>

            <div className="modal-actions">
              <button className="pill-btn pill-btn-secondary" onClick={closeCardModal}>
                Hủy
              </button>
              <button className="pill-btn pill-btn-primary" onClick={handleSaveCard} disabled={actionLoading}>
                {actionLoading ? <div className="loading-spinner" /> : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {warningModal && (
        <div className="modal-overlay" onClick={() => setWarningModal(null)}>
          <div className="modal-content compact-modal" onClick={(e) => e.stopPropagation()}>
            <div className={`modal-icon ${warningModal.type === 'delete' ? 'danger' : 'warning'}`}>
              {warningModal.type === 'delete' ? <BlockFilledIcon size={28} /> : <AlarmOnFilledIcon size={28} />}
            </div>
            <h3>{warningModal.type === 'delete' ? 'Xóa thẻ RFID' : 'Đổi trạng thái thẻ'}</h3>
            <p>
              {warningModal.type === 'delete'
                ? 'Thẻ sẽ bị xóa khỏi danh sách truy cập.'
                : `Thẻ sẽ được ${warningModal.extra ? 'tắt' : 'bật'} quyền truy cập.`}
            </p>
            <div className="modal-actions">
              <button className="pill-btn pill-btn-secondary" onClick={() => setWarningModal(null)}>
                Hủy
              </button>
              <button className="pill-btn pill-btn-danger" onClick={handleConfirmAction} disabled={actionLoading}>
                {actionLoading ? <div className="loading-spinner" /> : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
