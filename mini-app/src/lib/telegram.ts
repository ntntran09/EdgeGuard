export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export function formatTimeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (Number.isNaN(then)) return 'Không rõ thời gian';
  if (diffSeconds < 60) return 'Vừa xong';
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;
  if (diffHours < 24) return `${diffHours} giờ trước`;
  if (diffDays < 7) return `${diffDays} ngày trước`;

  return new Date(timestamp).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(date: Date = new Date()): string {
  return date.toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function getEventIcon(type: string): string {
  switch (type) {
    case 'access_granted': return '✅';
    case 'access_denied': return '🚫';
    case 'stranger_detected': return '👤';
    case 'object_left': return '🎒';
    case 'camera_blocked': return '📷';
    case 'rfid_scan': return '💳';
    default: return '📋';
  }
}

export function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'danger': return 'var(--accent-danger)';
    case 'warning': return 'var(--accent-warning)';
    case 'info':
    default: return 'var(--accent-success)';
  }
}
