import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEVICE_ID, requireAdmin } from '@/lib/server-auth';
import { removeStorageObject, uploadDataUrlToStorage } from '@/lib/supabase-image-storage';
import type { KnownFace } from '@/types';

interface KnownFaceRow {
  id: string;
  display_name: string;
  image_url?: string | null;
  image_bucket?: string | null;
  image_path?: string | null;
  is_active: boolean;
  added_at: string;
}

const MAX_FACE_IMAGE_BYTES = Math.floor(2.5 * 1024 * 1024);
const MAX_FACE_DATA_URL_LENGTH = Math.ceil(MAX_FACE_IMAGE_BYTES * 4 / 3) + 128;

function databaseRequired() {
  return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
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

  if (safeImageBase64 && safeImageBase64.length > MAX_FACE_DATA_URL_LENGTH) {
    return NextResponse.json({ ok: false, error: 'Image is too large' }, { status: 413 });
  }

  let storedImage = null;
  if (safeImageBase64) {
    try {
      storedImage = await uploadDataUrlToStorage({
        dataUrl: safeImageBase64,
        folder: 'known-faces',
        deviceId: DEVICE_ID,
        maxBytes: MAX_FACE_IMAGE_BYTES,
        metadata: { display_name: displayName.trim() },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cannot upload face image';
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from('known_faces')
    .insert([{
      device_id: DEVICE_ID,
      display_name: displayName.trim(),
      image_url: storedImage?.url || null,
      image_bucket: storedImage?.bucket || null,
      image_path: storedImage?.path || null,
      image_mime_type: storedImage?.contentType || null,
      image_bytes: storedImage?.bytes || null,
    }])
    .select()
    .single();

  if (error) {
    if (storedImage) {
      await removeStorageObject(storedImage.bucket, storedImage.path).catch((cleanupError) => {
        console.error('[API /faces] Failed to roll back uploaded face image:', cleanupError);
      });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
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

  const { data: face, error: faceError } = await supabase
    .from('known_faces')
    .select('image_bucket,image_path')
    .eq('device_id', DEVICE_ID)
    .eq('id', id)
    .maybeSingle();

  if (faceError) return NextResponse.json({ ok: false, error: faceError.message }, { status: 400 });

  const { error } = await supabase
    .from('known_faces')
    .update({
      is_active: false,
      image_url: null,
      image_bucket: null,
      image_path: null,
      image_mime_type: null,
      image_bytes: null,
    })
    .eq('device_id', DEVICE_ID)
    .eq('id', id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  let storageDeleted = true;
  await removeStorageObject(face?.image_bucket, face?.image_path).catch((cleanupError) => {
    storageDeleted = false;
    console.error('[API /faces] Failed to remove face image from Storage:', cleanupError);
  });
  return NextResponse.json({ ok: true, storageDeleted });
}
