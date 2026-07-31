export function notificationSeverityForAlert(alert, severityForAlertType) {
  if (alert?.severity) return alert.severity;
  if (typeof severityForAlertType === 'function') {
    return severityForAlertType(alert?.alertType);
  }
  return 'info';
}

export function shouldNotifyTelegramAlert(alert, severityForAlertType) {
  const severity = notificationSeverityForAlert(alert, severityForAlertType);
  return severity === 'danger' || alert?.alertType === 'object_left';
}

export function notificationDisplaySeverityForAlert(alert, severityForAlertType) {
  if (alert?.alertType === 'camera_blocked' || alert?.alertType === 'object_left') {
    return 'warning';
  }
  return notificationSeverityForAlert(alert, severityForAlertType);
}

export function escapeTelegramMarkdownText(value) {
  return String(value ?? '').replace(/([_*`\[])/g, '\\$1');
}

const SEVERITY_COPY = {
  danger: {
    icon: '🚨',
    badge: '🔴 Nguy hiểm',
    label: 'Nguy hiểm',
  },
  warning: {
    icon: '⚠️',
    badge: '🟠 Cảnh báo',
    label: 'Cần chú ý',
  },
  info: {
    icon: 'ℹ️',
    badge: '🔵 THÔNG TIN',
    label: 'Thông tin',
  },
};

export function notificationSeverityCopy(severity) {
  return SEVERITY_COPY[severity] || SEVERITY_COPY.info;
}

const ALERT_COPY = {
  stranger_detected: {
    typeLabel: 'Phát hiện người lạ',
    description: 'Có người lạ xuất hiện trong vùng quan sát. Vui lòng kiểm tra camera và khu vực cửa.',
  },
  camera_blocked: {
    typeLabel: 'Camera bị che',
    description: 'Camera bị che hoặc mất tầm nhìn, hệ thống không thể quan sát an toàn.',
  },
  object_left: {
    typeLabel: 'Vật thể bị bỏ lại',
    description: 'Có vật thể bị để lại trong vùng quan sát quá lâu.',
  },
  rfid_invalid: {
    typeLabel: 'Thẻ RFID không hợp lệ',
    description: 'Có lượt quét thẻ RFID/NFC chưa được cấp quyền.',
  },
  access_denied: {
    typeLabel: 'Truy cập bị từ chối',
    description: 'Một yêu cầu mở cửa đã bị từ chối.',
  },
  motion: {
    typeLabel: 'Phát hiện chuyển động',
    description: 'Cảm biến phát hiện chuyển động gần thiết bị.',
  },
  door_open: {
    typeLabel: 'Cửa đang mở',
    description: 'Cảm biến ghi nhận cửa đã được mở.',
  },
};

export function notificationCopyForAlert(alert) {
  const alertType = String(alert?.alertType || '').trim();
  return ALERT_COPY[alertType] || {
    typeLabel: alertType || 'Cảnh báo hệ thống',
    description: String(alert?.message || 'Hệ thống ghi nhận một sự kiện cần kiểm tra.'),
  };
}
