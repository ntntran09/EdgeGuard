import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { mockCards } from '@/lib/mock-data';
import type { RfidCard } from '@/types';

const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';

interface RfidCredentialRow {
  id: string;
  tag_id: string;
  name: string | null;
  is_active: boolean;
  added_at: string;
  last_used_at?: string | null;
}

async function logToAlerts(message: string, alertType = 'system_event') {
  if (!isSupabaseConfigured) return;

  await supabase.from('alerts').insert([{
    device_id: DEVICE_ID,
    alert_type: alertType,
    message,
    resolved: true,
  }]);
}

function mapCard(c: RfidCredentialRow): RfidCard {
  return {
    id: c.id,
    cardUid: c.tag_id,
    name: c.name || 'Chưa đặt tên',
    isActive: c.is_active,
    addedAt: c.added_at,
    lastUsedAt: c.last_used_at ?? undefined,
  };
}

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ cards: mockCards });
  }

  const { data, error } = await supabase
    .from('rfid_credentials')
    .select('*')
    .order('added_at', { ascending: false });

  if (error) {
    return NextResponse.json({ cards: mockCards });
  }

  return NextResponse.json({ cards: data.map(mapCard) });
}

export async function POST(request: Request) {
  try {
    const { cardUid, name } = await request.json();

    if (!cardUid || !name) {
      return NextResponse.json({ ok: false, error: 'cardUid và name là bắt buộc' }, { status: 422 });
    }

    if (!isSupabaseConfigured) {
      return NextResponse.json({
        ok: true,
        card: {
          id: crypto.randomUUID(),
          cardUid,
          name,
          isActive: true,
          addedAt: new Date().toISOString(),
        },
      }, { status: 201 });
    }

    const { data: existing } = await supabase
      .from('rfid_credentials')
      .select('id, is_active')
      .eq('tag_id', cardUid)
      .single();

    if (existing) {
      if (existing.is_active) {
        return NextResponse.json({ ok: false, error: 'Thẻ này đã tồn tại và đang hoạt động' }, { status: 409 });
      }

      const { data, error } = await supabase
        .from('rfid_credentials')
        .update({ is_active: true, name })
        .eq('tag_id', cardUid)
        .select()
        .single();

      if (error) throw error;
      await logToAlerts(`Đã kích hoạt lại thẻ ${cardUid} (${name})`);
      return NextResponse.json({ ok: true, card: mapCard(data) }, { status: 201 });
    }

    const { data, error } = await supabase
      .from('rfid_credentials')
      .insert([{ tag_id: cardUid, name, is_active: true }])
      .select()
      .single();

    if (error) throw error;
    await logToAlerts(`Đã thêm thẻ mới ${cardUid} (${name})`);
    return NextResponse.json({ ok: true, card: mapCard(data) }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, error: 'Dữ liệu không hợp lệ' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const { id, name, isActive, cardUid } = await request.json();

    if (!id) {
      return NextResponse.json({ ok: false, error: 'id là bắt buộc' }, { status: 422 });
    }

    if (!isSupabaseConfigured) {
      const existing = mockCards.find((card) => card.id === id);
      const card = {
        ...(existing || mockCards[0]),
        id,
        name: name ?? existing?.name ?? 'Chưa đặt tên',
        cardUid: cardUid ?? existing?.cardUid ?? 'UNKNOWN',
        isActive: isActive ?? existing?.isActive ?? true,
      };
      return NextResponse.json({ ok: true, card });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (isActive !== undefined) updates.is_active = isActive;
    if (cardUid !== undefined) updates.tag_id = cardUid;

    const { data, error } = await supabase
      .from('rfid_credentials')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (isActive !== undefined) {
      await logToAlerts(`Đã ${isActive ? 'bật' : 'tắt'} thẻ ${data.tag_id} (${data.name})`);
    } else if (name !== undefined) {
      await logToAlerts(`Đã cập nhật thẻ ${data.tag_id} thành "${name}"`);
    }

    return NextResponse.json({ ok: true, card: mapCard(data) });
  } catch {
    return NextResponse.json({ ok: false, error: 'Cập nhật thất bại' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ ok: false, error: 'id là bắt buộc' }, { status: 422 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true, message: 'Đã xóa thẻ' });
  }

  const { data: cardData } = await supabase
    .from('rfid_credentials')
    .select('tag_id, name')
    .eq('id', id)
    .single();

  const { error } = await supabase
    .from('rfid_credentials')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ ok: false, error: 'Không tìm thấy thẻ' }, { status: 404 });
  }

  if (cardData) {
    await logToAlerts(`Đã xóa thẻ ${cardData.tag_id} (${cardData.name})`);
  }

  return NextResponse.json({ ok: true, message: 'Đã xóa thẻ vĩnh viễn' });
}
