'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { api } from '@/lib/api';
import { formatTimeAgo } from '@/lib/telegram';
import {
  AlarmOnFilledIcon,
  BlockFilledIcon,
  ChevronRightFilledIcon,
  CreditCardFilledIcon,
  SettingsFilledIcon,
  ShieldFilledIcon,
} from '@/components/icons/FilledIcons';
import type { AlertConfig, KnownFace, PendingRfidScan, RfidCard } from '@/types';

type SettingsSection = 'menu' | 'system' | 'rfid' | 'faces';
const MAX_FACE_IMAGE_BYTES = 2.5 * 1024 * 1024;

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button className={`toggle-switch ${checked ? 'is-on' : ''}`} onClick={onChange} aria-label={label} aria-pressed={checked}>
      <span />
    </button>
  );
}

function NumberSetting({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`setting-number-row ${disabled ? 'is-disabled' : ''}`}>
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={3600}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))}
      />
    </label>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Cannot read file'));
    reader.readAsDataURL(file);
  });
}

export default function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>('menu');
  const [cards, setCards] = useState<RfidCard[]>([]);
  const [pending, setPending] = useState<PendingRfidScan[]>([]);
  const [faces, setFaces] = useState<KnownFace[]>([]);
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    objectLeftAlertEnabled: true,
    objectLeftMaxSeconds: 60,
    autoLockEnabled: true,
    autoLockSeconds: 10,
    strangerAlertEnabled: true,
    cameraBlockedAlertEnabled: true,
    rfidCardConfigurationEnabled: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [warningModal, setWarningModal] = useState<{ type: 'delete' | 'inactivate'; id: string; extra?: boolean } | null>(null);
  const [newFaceName, setNewFaceName] = useState('');
  const [newFaceImageBase64, setNewFaceImageBase64] = useState('');
  const [newFaceImageName, setNewFaceImageName] = useState('');
  const [faceUploadInputKey, setFaceUploadInputKey] = useState(0);

  const activeCards = useMemo(() => cards.filter((card) => card.isActive).length, [cards]);
  const isRfidCardConfigEnabled = Boolean(alertConfig.rfidCardConfigurationEnabled);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const [cardsRes, settingsRes, facesRes] = await Promise.all([
        api.getCards(),
        api.getSettings(),
        api.getFaces(),
      ]);

      setCards(cardsRes.cards || []);
      setPending(cardsRes.pending || []);
      setFaces(facesRes.faces || []);
      if (settingsRes.settings) {
        setAlertConfig((prev) => ({
          ...prev,
          ...settingsRes.settings,
          autoLockEnabled: settingsRes.settings.autoLockEnabled ?? (settingsRes.settings.autoLockSeconds !== null),
          objectLeftAlertEnabled: settingsRes.settings.objectLeftAlertEnabled ?? true,
        }));
      }
    } catch (error) {
      console.error('Failed to load settings', error);
      showToast('Không thể tải cài đặt');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadSettings();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [loadSettings]);

  const updateSetting = async <K extends keyof AlertConfig>(key: K, value: AlertConfig[K]) => {
    setAlertConfig((prev) => ({ ...prev, [key]: value }));
    try {
      await api.updateSettings({ [key]: value });
    } catch {
      showToast('Không thể lưu cài đặt');
    }
  };

  const handleAcceptPending = async (scan: PendingRfidScan) => {
    if (!isRfidCardConfigEnabled) {
      showToast('Vui lòng bật cấu hình thẻ RFID/NFC trước');
      return;
    }

    setActionLoading(true);
    try {
      const res = await api.acceptPendingCard(scan.id, `Thẻ ${scan.cardUid}`);
      if (res.card) setCards((prev) => [res.card, ...prev]);
      setPending((prev) => prev.filter((item) => item.id !== scan.id));
      showToast('Đã thêm thẻ RFID/NFC');
    } catch {
      showToast('Không thể thêm thẻ');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeclinePending = async (scan: PendingRfidScan) => {
    if (!isRfidCardConfigEnabled) {
      showToast('Vui lòng bật cấu hình thẻ RFID/NFC trước');
      return;
    }

    setActionLoading(true);
    try {
      await api.declinePendingCard(scan.id);
      setPending((prev) => prev.filter((item) => item.id !== scan.id));
      showToast('Đã từ chối thẻ');
    } catch {
      showToast('Không thể từ chối thẻ');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!warningModal) return;
    if (!isRfidCardConfigEnabled) {
      setWarningModal(null);
      showToast('Vui lòng bật cấu hình thẻ RFID/NFC trước');
      return;
    }

    setActionLoading(true);
    try {
      if (warningModal.type === 'delete') {
        await api.deleteCard(warningModal.id);
        setCards((prev) => prev.filter((card) => card.id !== warningModal.id));
      } else {
        const res = await api.editCard(warningModal.id, { isActive: !warningModal.extra });
        if (res.card) setCards((prev) => prev.map((card) => card.id === warningModal.id ? res.card : card));
      }
      setWarningModal(null);
      showToast('Đã cập nhật thẻ');
    } catch {
      showToast('Có lỗi xảy ra');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFaceImageChange = async (file?: File) => {
    if (!file) {
      setNewFaceImageBase64('');
      setNewFaceImageName('');
      setFaceUploadInputKey((key) => key + 1);
      return;
    }

    if (!file.type.startsWith('image/')) {
      showToast('Vui lòng chọn file ảnh');
      return;
    }

    if (file.size > MAX_FACE_IMAGE_BYTES) {
      showToast('Ảnh quá lớn, vui lòng chọn ảnh nhỏ hơn 2.5MB');
      return;
    }

    try {
      const imageBase64 = await readFileAsDataUrl(file);
      setNewFaceImageBase64(imageBase64);
      setNewFaceImageName(file.name);
    } catch {
      showToast('Không thể đọc file ảnh');
    }
  };

  const handleAddFace = async () => {
    if (!newFaceName.trim()) return showToast('Vui lòng nhập tên gương mặt');
    if (!newFaceImageBase64) return showToast('Vui lòng chọn ảnh gương mặt');
    setActionLoading(true);
    try {
      const res = await api.addFace(newFaceName.trim(), newFaceImageBase64);
      if (res.face) setFaces((prev) => [res.face, ...prev]);
      setNewFaceName('');
      setNewFaceImageBase64('');
      setNewFaceImageName('');
      setFaceUploadInputKey((key) => key + 1);
      showToast('Đã thêm gương mặt quen');
    } catch {
      showToast('Không thể thêm gương mặt');
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) return <div className="empty-state">Đang tải cài đặt...</div>;

  const titleMap: Record<SettingsSection, string> = {
    menu: 'Cài đặt',
    system: 'Hệ thống',
    rfid: 'RFID/NFC',
    faces: 'Gương mặt quen',
  };

  return (
    <div className="settings-page">
      {toast && <div className="toast">{toast}</div>}

      <header className={`page-header settings-page-header ${section !== 'menu' ? 'has-back' : ''}`}>
        {section !== 'menu' && (
          <button className="settings-back-button" onClick={() => setSection('menu')} aria-label="Quay lại">
            <ChevronRightFilledIcon size={24} />
          </button>
        )}
        <div>
          <p className="eyebrow">Quản trị thiết bị</p>
          <h1 className="text-heading-1">{titleMap[section]}</h1>
        </div>
      </header>

      {section === 'menu' && (
        <div className="settings-menu-grid">
          <button className="settings-menu-card" onClick={() => setSection('system')}>
            <SettingsFilledIcon size={24} />
            <span><strong>Hệ thống</strong><small>Auto-lock, cảnh báo AI và camera</small></span>
            <ChevronRightFilledIcon size={18} />
          </button>
          <button className="settings-menu-card" onClick={() => setSection('rfid')}>
            <CreditCardFilledIcon size={24} />
            <span><strong>RFID/NFC</strong><small>{activeCards}/{cards.length} thẻ hoạt động{pending.length ? `, ${pending.length} chờ duyệt` : ''}</small></span>
            <ChevronRightFilledIcon size={18} />
          </button>
          <button className="settings-menu-card" onClick={() => setSection('faces')}>
            <ShieldFilledIcon size={24} />
            <span><strong>Gương mặt quen</strong><small>{faces.length} hồ sơ nhận diện</small></span>
            <ChevronRightFilledIcon size={18} />
          </button>
        </div>
      )}

      {section === 'system' && (
        <section className="settings-detail-panel">
          <div className="setting-row">
            <div>
              <strong>Tự động khóa cửa</strong>
              <small>Bật để hệ thống tự khóa sau số giây đã cấu hình.</small>
            </div>
            <ToggleSwitch
              checked={Boolean(alertConfig.autoLockEnabled)}
              onChange={() => updateSetting('autoLockEnabled', !alertConfig.autoLockEnabled)}
              label="Tự động khóa cửa"
            />
          </div>
          <NumberSetting
            label="Thời gian chờ (giây)"
            value={alertConfig.autoLockSeconds || 10}
            disabled={!alertConfig.autoLockEnabled}
            onChange={(value) => updateSetting('autoLockSeconds', value)}
          />

          <div className="setting-row">
            <div>
              <strong>Vật thể bị bỏ lại</strong>
              <small>Bật cảnh báo khi AI thấy vật thể nằm lại quá thời gian cho phép.</small>
            </div>
            <ToggleSwitch
              checked={Boolean(alertConfig.objectLeftAlertEnabled)}
              onChange={() => updateSetting('objectLeftAlertEnabled', !alertConfig.objectLeftAlertEnabled)}
              label="Cảnh báo vật thể bị bỏ lại"
            />
          </div>
          <NumberSetting
            label="Ngưỡng cảnh báo (giây)"
            value={alertConfig.objectLeftMaxSeconds}
            disabled={!alertConfig.objectLeftAlertEnabled}
            onChange={(value) => updateSetting('objectLeftMaxSeconds', value)}
          />

          <div className="setting-row">
            <div><strong>Cảnh báo người lạ</strong><small>AI phát hiện người chưa xác định.</small></div>
            <ToggleSwitch checked={alertConfig.strangerAlertEnabled} onChange={() => updateSetting('strangerAlertEnabled', !alertConfig.strangerAlertEnabled)} label="Cảnh báo người lạ" />
          </div>
          <div className="setting-row">
            <div><strong>Camera bị che</strong><small>Cảnh báo khi tầm nhìn bị cản trở.</small></div>
            <ToggleSwitch checked={alertConfig.cameraBlockedAlertEnabled} onChange={() => updateSetting('cameraBlockedAlertEnabled', !alertConfig.cameraBlockedAlertEnabled)} label="Cảnh báo camera bị che" />
          </div>
        </section>
      )}

      {section === 'rfid' && (
        <section className="settings-detail-panel">
          <div className="setting-row">
            <div>
              <strong>Cấu hình thẻ RFID/NFC</strong>
              <small>Bật chế độ này để thêm, xóa, vô hiệu hóa hoặc hiệu hóa thẻ RFID/NFC.</small>
            </div>
            <ToggleSwitch
              checked={isRfidCardConfigEnabled}
              onChange={() => updateSetting('rfidCardConfigurationEnabled', !alertConfig.rfidCardConfigurationEnabled)}
              label="Cấu hình thẻ RFID/NFC"
            />
          </div>

          {!isRfidCardConfigEnabled && (
            <div className="rfid-config-note">Bật cấu hình thẻ RFID/NFC để thao tác với danh sách thẻ.</div>
          )}

          {pending.length > 0 && (
            <>
              <div className="panel-heading">
                <div>
                  <h2 className="text-heading-3">Thẻ chờ duyệt</h2>
                  <p className="text-caption">Chỉ xử lý được khi chế độ cấu hình thẻ RFID/NFC đang bật</p>
                </div>
              </div>
              <div className="rfid-list">
                {pending.map((scan) => (
                  <div className="rfid-card-row pending-rfid-row" key={scan.id}>
                    <div className="rfid-icon"><CreditCardFilledIcon size={22} /></div>
                    <div className="rfid-card-copy">
                      <div><strong>{scan.cardUid}</strong><span className="badge badge-warning">Chờ duyệt</span></div>
                      <small>Quét {scan.scanCount} lần, lần cuối {formatTimeAgo(scan.lastSeenAt)}</small>
                    </div>
                    <div className="row-actions">
                      <button className="mini-btn" onClick={() => handleAcceptPending(scan)} disabled={actionLoading || !isRfidCardConfigEnabled}>Duyệt</button>
                      <button className="mini-btn danger" onClick={() => handleDeclinePending(scan)} disabled={actionLoading || !isRfidCardConfigEnabled}>Từ chối</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="panel-heading">
            <div>
              <h2 className="text-heading-3">Thẻ đã cấp quyền</h2>
              <p className="text-caption">Danh sách RFID/NFC được phép mở cửa</p>
            </div>
            <span className="badge badge-info">{cards.length} thẻ</span>
          </div>
          <div className="rfid-list">
            {cards.length === 0 ? <div className="empty-state">Chưa có thẻ nào.</div> : cards.map((card) => (
              <div className="rfid-card-row" key={card.id}>
                <div className="rfid-icon"><CreditCardFilledIcon size={22} /></div>
                <div className="rfid-card-copy">
                  <div><strong>{card.name}</strong><span className={`badge ${card.isActive ? 'badge-success' : 'badge-danger'}`}>{card.isActive ? 'Hoạt động' : 'Đã tắt'}</span></div>
                  <small>{card.cardUid}</small>
                  {card.lastUsedAt && <small>Sử dụng {formatTimeAgo(card.lastUsedAt)}</small>}
                </div>
                <div className="row-actions">
                  <button className="mini-btn" onClick={() => setWarningModal({ type: 'inactivate', id: card.id, extra: card.isActive })} disabled={!isRfidCardConfigEnabled}>{card.isActive ? 'Tắt' : 'Bật'}</button>
                  <button className="mini-btn danger" onClick={() => setWarningModal({ type: 'delete', id: card.id })} disabled={!isRfidCardConfigEnabled}>Xóa</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {section === 'faces' && (
        <section className="settings-detail-panel">
          <div className="setting-block form-modal">
            <label>
              <span>Tên người quen</span>
              <input value={newFaceName} onChange={(e) => setNewFaceName(e.target.value)} placeholder="Nguyễn Văn A" />
            </label>
            <label className="face-upload-field">
              <span>Ảnh gương mặt</span>
              <input
                key={faceUploadInputKey}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void handleFaceImageChange(e.target.files?.[0])}
              />
              <small>{newFaceImageName || 'Chọn ảnh PNG, JPG hoặc WebP'}</small>
            </label>
            {newFaceImageBase64 && (
              <div className="face-upload-preview">
                <Image src={newFaceImageBase64} alt="Ảnh gương mặt đã chọn" width={72} height={72} />
                <button
                  className="mini-btn"
                  type="button"
                  onClick={() => {
                    setNewFaceImageBase64('');
                    setNewFaceImageName('');
                    setFaceUploadInputKey((key) => key + 1);
                  }}
                >
                  Đổi ảnh
                </button>
              </div>
            )}
            <button className="pill-btn pill-btn-primary" onClick={handleAddFace} disabled={actionLoading}>Thêm gương mặt</button>
          </div>
          <div className="face-grid">
            {faces.length === 0 ? <div className="empty-state">Chưa có gương mặt quen nào.</div> : faces.map((face) => (
              <div className="face-card" key={face.id}>
                {face.imageBase64 ? <Image src={face.imageBase64} alt={face.displayName} width={72} height={72} /> : <ShieldFilledIcon size={28} />}
                <span><strong>{face.displayName}</strong><small>Thêm {formatTimeAgo(face.addedAt)}</small></span>
                <button
                  className="mini-btn danger"
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      await api.deleteFace(face.id);
                      setFaces((prev) => prev.filter((item) => item.id !== face.id));
                      showToast('Đã xóa gương mặt');
                    } catch {
                      showToast('Không thể xóa gương mặt');
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                  disabled={actionLoading}
                >
                  Xóa
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {warningModal && (
        <div className="modal-overlay" onClick={() => setWarningModal(null)}>
          <div className="modal-content compact-modal" onClick={(e) => e.stopPropagation()}>
            <div className={`modal-icon ${warningModal.type === 'delete' ? 'danger' : 'warning'}`}>
              {warningModal.type === 'delete' ? <BlockFilledIcon size={28} /> : <AlarmOnFilledIcon size={28} />}
            </div>
            <h3>{warningModal.type === 'delete' ? 'Xóa thẻ RFID/NFC' : 'Đổi trạng thái thẻ'}</h3>
            <p>{warningModal.type === 'delete' ? 'Thẻ sẽ bị xóa khỏi danh sách truy cập.' : `Thẻ sẽ được ${warningModal.extra ? 'tắt' : 'bật'} quyền truy cập.`}</p>
            <div className="modal-actions">
              <button className="pill-btn pill-btn-secondary" onClick={() => setWarningModal(null)}>Hủy</button>
              <button className="pill-btn pill-btn-danger" onClick={handleConfirmAction} disabled={actionLoading}>{actionLoading ? <div className="loading-spinner" /> : 'Xác nhận'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
