import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { mockEvents } from '@/lib/mock-data';
import type { EventSeverity, EventType, SecurityEvent } from '@/types';

const aiTypes = ['stranger_detected', 'object_left', 'camera_blocked'];
const rfidTypes = ['access_granted', 'access_denied', 'rfid_scan', 'rfid_invalid', 'system_event'];

interface AiLogRow {
  id: string;
  label: string;
  created_at: string;
  image_path?: string | null;
  confidence?: number | null;
}

interface AlertRow {
  id: string;
  alert_type?: string | null;
  message?: string | null;
  timestamp?: string | null;
  created_at: string;
  thumbnail_url?: string | null;
}

function applyFilter(events: SecurityEvent[], filter: string | null) {
  if (!filter || filter === 'all') return events;
  if (filter === 'ai') return events.filter((event) => aiTypes.includes(event.type));
  if (filter === 'rfid') return events.filter((event) => rfidTypes.includes(event.type));
  return events;
}

function normalizeImagePath(path?: string | null) {
  if (!path) return undefined;
  if (path.startsWith('http') || path.startsWith('data:')) return path;
  return `/api/images/${path}`;
}

function getAiCopy(label: string) {
  switch (label) {
    case 'object_left':
      return {
        type: 'object_left' as EventType,
        title: 'Vật thể bị bỏ lại',
        description: 'Phát hiện vật thể bị bỏ quên trong khu vực giám sát',
        severity: 'warning' as EventSeverity,
      };
    case 'camera_blocked':
      return {
        type: 'camera_blocked' as EventType,
        title: 'Camera bị che',
        description: 'Tầm nhìn camera bị cản trở',
        severity: 'danger' as EventSeverity,
      };
    default:
      return {
        type: 'stranger_detected' as EventType,
        title: 'Phát hiện người lạ',
        description: 'AI phát hiện người chưa xác định',
        severity: 'warning' as EventSeverity,
      };
  }
}

function getAlertCopy(alertType: string) {
  switch (alertType) {
    case 'access_granted':
      return { type: 'access_granted' as EventType, title: 'Truy cập hợp lệ', severity: 'info' as EventSeverity };
    case 'access_denied':
    case 'rfid_invalid':
      return { type: 'access_denied' as EventType, title: 'Từ chối truy cập', severity: 'danger' as EventSeverity };
    case 'stranger_detected':
      return { type: 'stranger_detected' as EventType, title: 'Cảnh báo người lạ', severity: 'warning' as EventSeverity };
    case 'object_left':
      return { type: 'object_left' as EventType, title: 'Vật thể bị bỏ lại', severity: 'warning' as EventSeverity };
    case 'camera_blocked':
      return { type: 'camera_blocked' as EventType, title: 'Camera bị che', severity: 'danger' as EventSeverity };
    case 'system_event':
      return { type: 'system_event' as EventType, title: 'Hệ thống', severity: 'info' as EventSeverity };
    default:
      return { type: 'rfid_scan' as EventType, title: 'Cảnh báo', severity: 'info' as EventSeverity };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter');

  if (!isSupabaseConfigured) {
    return NextResponse.json({ events: applyFilter(mockEvents, filter) });
  }

  try {
    let aiLogsData: AiLogRow[] = [];
    let alertsData: AlertRow[] = [];

    if (!filter || filter === 'all' || filter === 'ai') {
      const { data, error } = await supabase
        .from('ai_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (!error && data) aiLogsData = data;
    }

    if (!filter || filter === 'all' || filter === 'rfid' || filter === 'ai') {
      const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (!error && data) alertsData = data;
    }

    const events: SecurityEvent[] = [
      ...aiLogsData.map((log) => {
        const copy = getAiCopy(log.label);

        return {
          id: `ai-${log.id}`,
          type: copy.type,
          title: copy.title,
          description: copy.description,
          timestamp: log.created_at,
          thumbnailUrl: normalizeImagePath(log.image_path),
          aiConfidence: log.confidence ?? undefined,
          severity: copy.severity,
        };
      }),
      ...alertsData.flatMap((alert) => {
        const copy = getAlertCopy(alert.alert_type || 'system_event');

        if (filter === 'rfid' && !rfidTypes.includes(copy.type)) return [];
        if (filter === 'ai' && !aiTypes.includes(copy.type)) return [];

        return [{
          id: `alert-${alert.id}`,
          type: copy.type,
          title: copy.title,
          description: alert.message || 'Hệ thống ghi nhận sự kiện',
          timestamp: alert.timestamp || alert.created_at,
          thumbnailUrl: normalizeImagePath(alert.thumbnail_url),
          severity: copy.severity,
        }];
      }),
    ];

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ events });
  } catch (error) {
    console.error('[API /events] GET Error:', error);
    return NextResponse.json({ events: applyFilter(mockEvents, filter) });
  }
}
