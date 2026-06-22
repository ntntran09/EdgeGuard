import { NextResponse } from 'next/server';
import { mockEvents } from '@/lib/mock-data';
import { getRequester } from '@/lib/server-auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { EventCategory, EventSeverity, EventType, SecurityEvent } from '@/types';

const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';

const rfidTypes = ['rfid_scan', 'rfid_invalid', 'rfid_added', 'rfid_deleted'];
const filterMap: Record<string, string[]> = {
  person: ['person_detected', 'stranger_detected'],
  stranger: ['stranger_detected'],
  object: ['object_detected', 'object_left', 'unknown_object'],
  unknown_object: ['unknown_object', 'object_left'],
  door: ['door_unlocked', 'door_locked', 'access_granted'],
  unlock: ['door_unlocked', 'access_granted'],
  rfid: rfidTypes,
  rfid_added: ['rfid_added'],
  rfid_deleted: ['rfid_deleted'],
  rfid_invalid: ['rfid_invalid'],
};

interface SecurityEventRow {
  id: string;
  event_type: string;
  description: string | null;
  severity: EventSeverity | null;
  source: string | null;
  category: EventCategory | null;
  is_admin_only: boolean | null;
  thumbnail_url: string | null;
  ai_confidence: number | null;
  occurred_at: string;
  metadata?: Record<string, unknown> | null;
}

function applyFilter(events: SecurityEvent[], filter: string | null) {
  if (!filter || filter === 'all') return events;
  if (filterMap[filter]) return events.filter((event) => filterMap[filter].includes(event.type));
  return events;
}

function normalizeImagePath(path?: string | null) {
  if (!path) return undefined;
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('/')) return path;
  return `/api/images/${path}`;
}

function copyForEvent(type: string, description?: string | null) {
  switch (type) {
    case 'access_granted':
      return { type: 'access_granted' as EventType, title: 'Mở khóa bằng RFID', severity: 'info' as EventSeverity };
    case 'door_unlocked':
      return { type: 'door_unlocked' as EventType, title: 'Mở khóa cửa', severity: 'info' as EventSeverity };
    case 'door_locked':
      return { type: 'door_locked' as EventType, title: 'Khóa cửa', severity: 'info' as EventSeverity };
    case 'access_denied':
    case 'rfid_invalid':
      return { type: 'access_denied' as EventType, title: 'Truy cập bị từ chối', severity: 'danger' as EventSeverity };
    case 'rfid_added':
      return { type: 'rfid_added' as EventType, title: 'Thêm thẻ RFID/NFC', severity: 'info' as EventSeverity };
    case 'rfid_deleted':
      return { type: 'rfid_deleted' as EventType, title: 'Xóa/Từ chối thẻ RFID/NFC', severity: 'warning' as EventSeverity };
    case 'rfid_scan':
      return { type: 'rfid_scan' as EventType, title: 'Quét thẻ RFID', severity: 'info' as EventSeverity };
    case 'person_detected':
      return { type: 'person_detected' as EventType, title: 'Phát hiện người', severity: 'info' as EventSeverity };
    case 'object_detected':
      return { type: 'object_detected' as EventType, title: 'Phát hiện vật thể', severity: 'info' as EventSeverity };
    case 'object_left':
    case 'unknown_object':
      return { type: 'object_left' as EventType, title: 'Vật thể bị bỏ lại', severity: 'warning' as EventSeverity };
    case 'camera_blocked':
      return { type: 'camera_blocked' as EventType, title: 'Camera bị che', severity: 'danger' as EventSeverity };
    case 'stranger_detected':
      return { type: 'stranger_detected' as EventType, title: 'Phát hiện người lạ', severity: 'danger' as EventSeverity };
    default:
      return {
        type: 'system_event' as EventType,
        title: description?.slice(0, 42) || 'Sự kiện hệ thống',
        severity: 'info' as EventSeverity,
      };
  }
}

function mapRow(row: SecurityEventRow, viewedIds = new Set<string>()): SecurityEvent {
  const copy = copyForEvent(row.event_type, row.description);
  const metadata = row.metadata || {};
  const cardId = typeof metadata.card_id === 'string'
    ? metadata.card_id
    : typeof metadata.tag_id === 'string'
      ? metadata.tag_id
      : undefined;

  return {
    id: row.id,
    type: copy.type,
    title: copy.title,
    description: row.description || copy.title,
    timestamp: row.occurred_at,
    thumbnailUrl: normalizeImagePath(row.thumbnail_url),
    aiConfidence: row.ai_confidence ?? undefined,
    severity: row.severity || copy.severity,
    cardId,
    category: row.category || undefined,
    isAdminOnly: Boolean(row.is_admin_only),
    isViewed: viewedIds.has(row.id),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter');
  const requester = await getRequester(request);
  const isAdmin = requester.role === 'admin';

  if (!isSupabaseConfigured) {
    const events = applyFilter(mockEvents, filter).filter((event) => isAdmin || !event.isAdminOnly);
    return NextResponse.json({ events });
  }

  try {
    let query = supabase
      .from('security_events')
      .select('id,event_type,description,severity,source,category,is_admin_only,thumbnail_url,ai_confidence,occurred_at,metadata')
      .eq('device_id', DEVICE_ID)
      .order('occurred_at', { ascending: false })
      .limit(60);

    if (filter && filter !== 'all' && filterMap[filter]) {
      query = query.in('event_type', filterMap[filter]);
    }

    if (!isAdmin) query = query.eq('is_admin_only', false);

    const { data, error } = await query;

    if (error) throw error;

    const rows = data || [];
    const eventIds = rows.map((row) => row.id);
    let viewedIds = new Set<string>();

    if (eventIds.length) {
      const viewerId = requester.telegramId || 'dev';
      const { data: viewedRows, error: viewedError } = await supabase
        .from('security_event_views')
        .select('event_id')
        .eq('device_id', DEVICE_ID)
        .eq('telegram_id', viewerId)
        .in('event_id', eventIds);

      if (!viewedError) {
        viewedIds = new Set((viewedRows || []).map((row) => row.event_id));
      }
    }

    return NextResponse.json({ events: rows.map((row) => mapRow(row, viewedIds)) });
  } catch (error) {
    console.error('[API /events] GET Error:', error);
    return NextResponse.json({ events: applyFilter(mockEvents, filter) });
  }
}

export async function POST(request: Request) {
  try {
    const requester = await getRequester(request);
    const { eventId, eventIds } = await request.json();
    const ids = Array.isArray(eventIds)
      ? eventIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : typeof eventId === 'string' && eventId.trim().length > 0
        ? [eventId]
        : [];

    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: 'eventId or eventIds is required' }, { status: 422 });
    }

    if (!isSupabaseConfigured) {
      return NextResponse.json({ ok: true });
    }

    const viewerId = requester.telegramId || 'dev';
    const { error } = await supabase
      .from('security_event_views')
      .upsert(ids.map((id) => ({
        device_id: DEVICE_ID,
        telegram_id: viewerId,
        event_id: id,
        viewed_at: new Date().toISOString(),
      })), { onConflict: 'device_id,telegram_id,event_id' });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API /events] POST Error:', error);
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  }
}
