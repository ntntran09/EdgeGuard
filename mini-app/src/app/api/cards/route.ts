import { NextResponse } from 'next/server';
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

function databaseRequired() {
  return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
}

function normalizeTagId(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toUpperCase().replace(/[^0-9A-F]/g, '');
}

async function logToAlerts(message: string, alertType = 'system_event', metadata: Record<string, unknown> = {}) {
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
    name: card.name || 'Chua dat ten',
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

async function isRfidCardConfigurationEnabled() {
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
    error: 'Bat cau hinh the RFID/NFC truoc khi thay doi danh sach the',
  }, { status: 409 });
}

export async function GET(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ cards: [], pending: [] }, { status: 403 });
  }

  if (!isSupabaseConfigured) return databaseRequired();

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
    return NextResponse.json({ ok: false, error: 'Cannot load RFID/NFC cards' }, { status: 400 });
  }

  return NextResponse.json({
    cards: (cardsResult.data || []).map(mapCard),
    pending: (pendingResult.data || []).map(mapPending),
  });
}

export async function POST(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
  }

  if (!isSupabaseConfigured) return databaseRequired();

  try {
    const { pendingId, cardUid, name, action } = await request.json();

    if (!(await isRfidCardConfigurationEnabled())) {
      return rfidCardConfigurationRequiredResponse();
    }

    if (pendingId) {
      if (!['accept', 'decline'].includes(action)) {
        return NextResponse.json({ ok: false, error: 'pendingId and action are required' }, { status: 422 });
      }

      const { data: pending, error: pendingError } = await supabase
        .from('pending_rfid_scans')
        .select('*')
        .eq('device_id', DEVICE_ID)
        .eq('id', pendingId)
        .eq('status', 'pending')
        .single();

      if (pendingError || !pending) {
        return NextResponse.json({ ok: false, error: 'Pending RFID/NFC scan not found' }, { status: 404 });
      }

      const review = {
        status: action === 'accept' ? 'accepted' : 'declined',
        reviewed_by_telegram_id: requester.telegramId,
        reviewed_at: new Date().toISOString(),
      };

      if (action === 'decline') {
        await supabase.from('pending_rfid_scans').update(review).eq('id', pendingId);
        await logToAlerts(`Tu choi the RFID/NFC ${pending.tag_id}`, 'rfid_deleted', { tag_id: pending.tag_id });
        return NextResponse.json({ ok: true });
      }

      const { data: card, error: cardError } = await supabase
        .from('rfid_credentials')
        .upsert({
          device_id: DEVICE_ID,
          tag_id: normalizeTagId(pending.tag_id),
          name: name || `The ${pending.tag_id}`,
          is_active: true,
        }, { onConflict: 'device_id,tag_id' })
        .select()
        .single();

      if (cardError) throw cardError;

      await supabase.from('pending_rfid_scans').update(review).eq('id', pendingId);
      await logToAlerts(`Da them the RFID/NFC ${card.tag_id} (${card.name})`, 'rfid_added', { tag_id: card.tag_id, card_id: card.id });

      return NextResponse.json({ ok: true, card: mapCard(card) }, { status: 201 });
    }

    const normalizedCardUid = normalizeTagId(cardUid);
    if (!normalizedCardUid) {
      return NextResponse.json({ ok: false, error: 'cardUid is required' }, { status: 422 });
    }

    const { data: card, error: cardError } = await supabase
      .from('rfid_credentials')
      .upsert({
        device_id: DEVICE_ID,
        tag_id: normalizedCardUid,
        name: name || `The ${normalizedCardUid}`,
        is_active: true,
      }, { onConflict: 'device_id,tag_id' })
      .select()
      .single();

    if (cardError) throw cardError;

    await logToAlerts(`Da them the RFID/NFC ${card.tag_id} (${card.name})`, 'rfid_added', { tag_id: card.tag_id, card_id: card.id });
    return NextResponse.json({ ok: true, card: mapCard(card) }, { status: 201 });
  } catch (error) {
    console.error('[API /cards] POST Error:', error);
    return NextResponse.json({ ok: false, error: 'Cannot process RFID/NFC card' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
  }

  if (!isSupabaseConfigured) return databaseRequired();

  try {
    const { id, name, isActive } = await request.json();

    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 422 });
    }

    if (!(await isRfidCardConfigurationEnabled())) {
      return rfidCardConfigurationRequiredResponse();
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

    await logToAlerts(`Da cap nhat the RFID/NFC ${data.tag_id} (${data.name})`, 'rfid_added', { tag_id: data.tag_id, card_id: data.id });
    return NextResponse.json({ ok: true, card: mapCard(data) });
  } catch (error) {
    console.error('[API /cards] PUT Error:', error);
    return NextResponse.json({ ok: false, error: 'Cannot update RFID/NFC card' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
  }

  if (!isSupabaseConfigured) return databaseRequired();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ ok: false, error: 'id is required' }, { status: 422 });
  }

  if (!(await isRfidCardConfigurationEnabled())) {
    return rfidCardConfigurationRequiredResponse();
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
    return NextResponse.json({ ok: false, error: 'RFID/NFC card not found' }, { status: 404 });
  }

  if (cardData) {
    await logToAlerts(`Da xoa the RFID/NFC ${cardData.tag_id} (${cardData.name})`, 'rfid_deleted', { tag_id: cardData.tag_id });
  }

  return NextResponse.json({ ok: true, message: 'RFID/NFC card deleted' });
}
