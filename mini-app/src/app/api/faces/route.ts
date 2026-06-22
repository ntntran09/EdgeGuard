import { NextResponse } from 'next/server';
import { getExampleFlow } from '@/lib/example-flow';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEVICE_ID, requireAdmin } from '@/lib/server-auth';
import type { KnownFace } from '@/types';

interface KnownFaceRow {
  id: string;
  display_name: string;
  image_url?: string | null;
  is_active: boolean;
  added_at: string;
}

function mapFace(row: KnownFaceRow): KnownFace {
  return {
    id: row.id,
    displayName: row.display_name,
    imageUrl: row.image_url || undefined,
    isActive: row.is_active,
    addedAt: row.added_at,
  };
}

export async function GET(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) return NextResponse.json({ faces: [] }, { status: 403 });

  if (getExampleFlow()) {
    return NextResponse.json({
      faces: [{
        id: 'demo-face-1',
        displayName: 'Nguoi dung quen',
        isActive: true,
        addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
      }],
    });
  }

  if (!isSupabaseConfigured) return NextResponse.json({ faces: [] });

  const { data, error } = await supabase
    .from('known_faces')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .eq('is_active', true)
    .order('added_at', { ascending: false });

  if (error) return NextResponse.json({ faces: [] }, { status: 400 });
  return NextResponse.json({ faces: (data || []).map(mapFace) });
}

export async function POST(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được thêm gương mặt' }, { status: 403 });
  }

  const { displayName, imageUrl } = await request.json();
  if (!displayName?.trim()) {
    return NextResponse.json({ ok: false, error: 'displayName là bắt buộc' }, { status: 422 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      ok: true,
      face: {
        id: crypto.randomUUID(),
        displayName,
        imageUrl,
        isActive: true,
        addedAt: new Date().toISOString(),
      },
    }, { status: 201 });
  }

  const { data, error } = await supabase
    .from('known_faces')
    .insert([{ device_id: DEVICE_ID, display_name: displayName.trim(), image_url: imageUrl || null }])
    .select()
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, face: mapFace(data) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được xóa gương mặt' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id là bắt buộc' }, { status: 422 });

  if (!isSupabaseConfigured) return NextResponse.json({ ok: true });

  const { error } = await supabase
    .from('known_faces')
    .update({ is_active: false })
    .eq('device_id', DEVICE_ID)
    .eq('id', id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
