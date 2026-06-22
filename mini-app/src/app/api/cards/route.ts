import { NextResponse } from 'next/server';
import { getExampleFlow } from '@/lib/example-flow';
import { defaultAlertConfig, mockCards } from '@/lib/mock-data';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEVICE_ID, requireAdmin } from '@/lib/server-auth';
import type { PendingRfidScan, RfidCard } from '@/types';

interface RfidCredentialRow {
  id: string;
  tag_id: string;
  name: string | null;
  is_active: boolean;
  added_at: string;
  last_used_at?: string | null;
}

interface PendingRfidRow {
  id: string;
  tag_id: string;
  first_seen_at: string;
  last_seen_at: string;
  scan_count: number;
}

async function logToAlerts(message: string, alertType = 'system_event', metadata: Record<string, unknown> = {}) {
  if (!isSupabaseConfigured) return;

  await supabase.from('alerts').insert([{
    device_id: DEVICE_ID,
    alert_type: alertType,
    message,
    source: 'rfid',
    severity: 'info',
    metadata,
    resolved: true,
  }]);
}

function mapCard(card: RfidCredentialRow): RfidCard {
  return {
    id: card.id,
    cardUid: card.tag_id,
    name: card.name || 'Chưa đặt tên',
    isActive: card.is_active,
    addedAt: card.added_at,
    lastUsedAt: card.last_used_at ?? undefined,
  };
}

function mapPending(row: PendingRfidRow): PendingRfidScan {
  return {
    id: row.id,
    cardUid: row.tag_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    scanCount: row.scan_count,
  };
}

function getExamplePendingScans(): PendingRfidScan[] {
  const now = Date.now();

  return [{
    id: 'pending-configure-rfid',
    cardUid: 'C9:71:4D:20',
    firstSeenAt: new Date(now - 90_000).toISOString(),
    lastSeenAt: new Date(now - 10_000).toISOString(),
    scanCount: 2,
  }];
}

async function isRfidCardConfigurationEnabled() {
  const exampleFlow = getExampleFlow();
  if (exampleFlow) return exampleFlow.key === 'configure_rfid';

  if (!isSupabaseConfigured) {
    return Boolean(getRuntimeSettings(defaultAlertConfig).rfidCardConfigurationEnabled);
  }

  const { data, error } = await supabase
    .from('device_settings')
    .select('master_key_enabled')
    .eq('device_id', DEVICE_ID)
    .maybeSingle();

  if (error) {
    console.error('[API /cards] Failed to read RFID/NFC card configuration setting:', error);
    return false;
  }

  return Boolean(data?.master_key_enabled);
}

function rfidCardConfigurationRequiredResponse() {
  return NextResponse.json({
    ok: false,
    error: 'Vui lòng bật cấu hình thẻ RFID/NFC trước khi thêm, xóa, vô hiệu hóa hoặc hiệu hóa thẻ',
  }, { status: 409 });
}

export async function GET(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ cards: [], pending: [] }, { status: 403 });
  }

  const exampleFlow = getExampleFlow();

  if (exampleFlow) {
    return NextResponse.json({
      cards: mockCards.map((card, index) => ({
        ...card,
        lastUsedAt: index === 0 ? new Date().toISOString() : card.lastUsedAt,
      })),
      pending: exampleFlow.key === 'configure_rfid' ? getExamplePendingScans() : [],
    });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ cards: mockCards, pending: [] });
  }

  const [cardsResult, pendingResult] = await Promise.all([
    supabase
      .from('rfid_credentials')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .order('added_at', { ascending: false }),
    supabase
      .from('pending_rfid_scans')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .eq('status', 'pending')
      .order('last_seen_at', { ascending: false }),
  ]);

  if (cardsResult.error || pendingResult.error) {
    console.error('[API /cards] GET Error:', cardsResult.error || pendingResult.error);
    return NextResponse.json({ cards: mockCards, pending: [] });
  }

  return NextResponse.json({
    cards: (cardsResult.data || []).map(mapCard),
    pending: (pendingResult.data || []).map(mapPending),
  });
}

export async function POST(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được duyệt thẻ RFID/NFC' }, { status: 403 });
  }

  try {
    const { pendingId, name, action } = await request.json();

    if (!pendingId || !['accept', 'decline'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'pendingId và action là bắt buộc' }, { status: 422 });
    }

    if (!(await isRfidCardConfigurationEnabled())) {
      return rfidCardConfigurationRequiredResponse();
    }

    if (getExampleFlow() || !isSupabaseConfigured) {
      if (action === 'decline') return NextResponse.json({ ok: true });

      return NextResponse.json({
        ok: true,
        card: {
          id: crypto.randomUUID(),
          cardUid: pendingId === 'pending-configure-rfid' ? 'C9:71:4D:20' : 'PENDING:DEMO',
          name: name || 'Thẻ mới',
          isActive: true,
          addedAt: new Date().toISOString(),
        },
      }, { status: 201 });
    }

    const { data: pending, error: pendingError } = await supabase
      .from('pending_rfid_scans')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .eq('id', pendingId)
      .eq('status', 'pending')
      .single();

    if (pendingError || !pending) {
      return NextResponse.json({ ok: false, error: 'Không tìm thấy thẻ đang chờ duyệt' }, { status: 404 });
    }

    const review = {
      status: action === 'accept' ? 'accepted' : 'declined',
      reviewed_by_telegram_id: requester.telegramId,
      reviewed_at: new Date().toISOString(),
    };

    if (action === 'decline') {
      await supabase.from('pending_rfid_scans').update(review).eq('id', pendingId);
      await logToAlerts(`Đã từ chối thẻ RFID/NFC ${pending.tag_id}`, 'rfid_deleted', { tag_id: pending.tag_id });
      return NextResponse.json({ ok: true });
    }

    const { data: card, error: cardError } = await supabase
      .from('rfid_credentials')
      .upsert({
        device_id: DEVICE_ID,
        tag_id: pending.tag_id,
        name: name || `Thẻ ${pending.tag_id}`,
        is_active: true,
      }, { onConflict: 'device_id,tag_id' })
      .select()
      .single();

    if (cardError) throw cardError;

    await supabase.from('pending_rfid_scans').update(review).eq('id', pendingId);
    await logToAlerts(`Đã thêm thẻ RFID/NFC ${pending.tag_id} (${card.name})`, 'rfid_added', { tag_id: pending.tag_id, card_id: card.id });

    return NextResponse.json({ ok: true, card: mapCard(card) }, { status: 201 });
  } catch (error) {
    console.error('[API /cards] POST Error:', error);
    return NextResponse.json({ ok: false, error: 'Không thể xử lý thẻ đang chờ duyệt' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được cập nhật thẻ' }, { status: 403 });
  }

  try {
    const { id, name, isActive } = await request.json();

    if (!id) {
      return NextResponse.json({ ok: false, error: 'id là bắt buộc' }, { status: 422 });
    }

    if (!(await isRfidCardConfigurationEnabled())) {
      return rfidCardConfigurationRequiredResponse();
    }

    if (getExampleFlow() || !isSupabaseConfigured) {
      const existing = mockCards.find((card) => card.id === id);
      const card = {
        ...(existing || mockCards[0]),
        id,
        name: name ?? existing?.name ?? 'Chưa đặt tên',
        isActive: isActive ?? existing?.isActive ?? true,
      };
      return NextResponse.json({ ok: true, card });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (isActive !== undefined) updates.is_active = isActive;

    const { data, error } = await supabase
      .from('rfid_credentials')
      .update(updates)
      .eq('device_id', DEVICE_ID)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logToAlerts(`Đã cập nhật thẻ RFID/NFC ${data.tag_id} (${data.name})`, 'rfid_added', { tag_id: data.tag_id, card_id: data.id });
    return NextResponse.json({ ok: true, card: mapCard(data) });
  } catch (error) {
    console.error('[API /cards] PUT Error:', error);
    return NextResponse.json({ ok: false, error: 'Cập nhật thất bại' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được xóa thẻ' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ ok: false, error: 'id là bắt buộc' }, { status: 422 });
  }

  if (!(await isRfidCardConfigurationEnabled())) {
    return rfidCardConfigurationRequiredResponse();
  }

  if (getExampleFlow() || !isSupabaseConfigured) {
    return NextResponse.json({ ok: true, message: 'Đã xóa thẻ' });
  }

  const { data: cardData } = await supabase
    .from('rfid_credentials')
    .select('tag_id, name')
    .eq('device_id', DEVICE_ID)
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase
    .from('rfid_credentials')
    .delete()
    .eq('device_id', DEVICE_ID)
    .eq('id', id);

  if (error) {
    return NextResponse.json({ ok: false, error: 'Không tìm thấy thẻ' }, { status: 404 });
  }

  if (cardData) {
    await logToAlerts(`Đã xóa thẻ RFID/NFC ${cardData.tag_id} (${cardData.name})`, 'rfid_deleted', { tag_id: cardData.tag_id });
  }

  return NextResponse.json({ ok: true, message: 'Đã xóa thẻ vĩnh viễn' });
}
