import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEVICE_ID, requireAdmin } from '@/lib/server-auth';
import type { KnownFace } from '@/types';

interface KnownFaceRow {
  id: string;
  display_name: string;
  image_base64?: string | null;
  is_active: boolean;
  added_at: string;
}

const MAX_FACE_IMAGE_BASE64_LENGTH = 3_500_000;
const IMAGE_BASE64_PATTERN = /^data:image\/(png|jpe?g|webp);base64,/i;

function databaseRequired() {
  return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
}

function mapFace(row: KnownFaceRow): KnownFace {
  return {
    id: row.id,
    displayName: row.display_name,
    imageBase64: row.image_base64 || undefined,
    isActive: row.is_active,
    addedAt: row.added_at,
  };
}

export async function GET(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) return NextResponse.json({ faces: [] }, { status: 403 });
  if (!isSupabaseConfigured) return databaseRequired();

  const { data, error } = await supabase
    .from('known_faces')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .eq('is_active', true)
    .order('added_at', { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message, faces: [] }, { status: 400 });
  return NextResponse.json({ faces: (data || []).map(mapFace) });
}

export async function POST(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
  }
  if (!isSupabaseConfigured) return databaseRequired();

  const { displayName, imageBase64 } = await request.json();
  if (!displayName?.trim()) {
    return NextResponse.json({ ok: false, error: 'displayName is required' }, { status: 422 });
  }

  const safeImageBase64 = typeof imageBase64 === 'string' && imageBase64.trim()
    ? imageBase64.trim()
    : null;

  if (safeImageBase64 && !IMAGE_BASE64_PATTERN.test(safeImageBase64)) {
    return NextResponse.json({ ok: false, error: 'Image must be PNG, JPG or WebP base64' }, { status: 422 });
  }

  if (safeImageBase64 && safeImageBase64.length > MAX_FACE_IMAGE_BASE64_LENGTH) {
    return NextResponse.json({ ok: false, error: 'Image is too large' }, { status: 413 });
  }

  const { data, error } = await supabase
    .from('known_faces')
    .insert([{ device_id: DEVICE_ID, display_name: displayName.trim(), image_base64: safeImageBase64 }])
    .select()
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, face: mapFace(data) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
  }
  if (!isSupabaseConfigured) return databaseRequired();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 422 });

  const { error } = await supabase
    .from('known_faces')
    .update({ is_active: false })
    .eq('device_id', DEVICE_ID)
    .eq('id', id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
