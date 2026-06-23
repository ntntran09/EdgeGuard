import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getExampleFlow } from '@/lib/example-flow';
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
const SEEDED_EXAMPLE_FACES = [
  { id: 'example-face-ngoc', displayName: 'Ngọc', fileName: 'Ngọc.jpg' },
  { id: 'example-face-tran', displayName: 'Trân', fileName: 'Trân.jpg' },
];

function mapFace(row: KnownFaceRow): KnownFace {
  return {
    id: row.id,
    displayName: row.display_name,
    imageBase64: row.image_base64 || undefined,
    isActive: row.is_active,
    addedAt: row.added_at,
  };
}

function readExampleFaceBase64(fileName: string) {
  try {
    const filePath = join(process.cwd(), 'public', 'img', 'example_face', fileName);
    return `data:image/jpeg;base64,${readFileSync(filePath).toString('base64')}`;
  } catch (error) {
    console.error('[API /faces] Failed to load example face image:', fileName, error);
    return undefined;
  }
}

function getSeededExampleFaces(): KnownFace[] {
  return SEEDED_EXAMPLE_FACES.map((face, index) => ({
    id: face.id,
    displayName: face.displayName,
    imageBase64: readExampleFaceBase64(face.fileName),
    isActive: true,
    addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * (index + 2)).toISOString(),
  }));
}

function isFaceConfigurationExample() {
  return getExampleFlow()?.key === 'configure_faces';
}

export async function GET(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) return NextResponse.json({ faces: [] }, { status: 403 });

  if (isFaceConfigurationExample()) {
    return NextResponse.json({
      faces: getSeededExampleFaces(),
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

  const { displayName, imageBase64 } = await request.json();
  if (!displayName?.trim()) {
    return NextResponse.json({ ok: false, error: 'displayName là bắt buộc' }, { status: 422 });
  }

  const safeImageBase64 = typeof imageBase64 === 'string' && imageBase64.trim()
    ? imageBase64.trim()
    : null;

  if (safeImageBase64 && !IMAGE_BASE64_PATTERN.test(safeImageBase64)) {
    return NextResponse.json({ ok: false, error: 'Ảnh phải là file PNG, JPG hoặc WebP dạng base64' }, { status: 422 });
  }

  if (safeImageBase64 && safeImageBase64.length > MAX_FACE_IMAGE_BASE64_LENGTH) {
    return NextResponse.json({ ok: false, error: 'Ảnh quá lớn, vui lòng chọn ảnh nhỏ hơn 2.5MB' }, { status: 413 });
  }

  if (isFaceConfigurationExample() || !isSupabaseConfigured) {
    return NextResponse.json({
      ok: true,
      face: {
        id: crypto.randomUUID(),
        displayName,
        imageBase64: safeImageBase64 || undefined,
        isActive: true,
        addedAt: new Date().toISOString(),
      },
    }, { status: 201 });
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
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được xóa gương mặt' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id là bắt buộc' }, { status: 422 });

  if (isFaceConfigurationExample() || !isSupabaseConfigured) return NextResponse.json({ ok: true });

  const { error } = await supabase
    .from('known_faces')
    .update({ is_active: false })
    .eq('device_id', DEVICE_ID)
    .eq('id', id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
