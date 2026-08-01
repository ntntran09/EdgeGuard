import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEVICE_ID, requireAdmin } from '@/lib/server-auth';
import { removeStorageObject, uploadDataUrlToStorage } from '@/lib/supabase-image-storage';
import { indexFace, deleteFace, isRekognitionConfigured } from '@/lib/rekognition';
import type { KnownFace } from '@/types';

interface KnownFaceRow {
  id: string;
  display_name: string;
  image_url?: string | null;
  image_bucket?: string | null;
  image_path?: string | null;
  rekognition_face_id?: string | null;
  is_active: boolean;
  added_at: string;
}

const MAX_FACE_IMAGE_BYTES = Math.floor(2.5 * 1024 * 1024);
const MAX_FACE_DATA_URL_LENGTH = Math.ceil(MAX_FACE_IMAGE_BYTES * 4 / 3) + 128;
const DATA_URL_PATTERN = /^data:[^;,]+;base64,(.+)$/;

function databaseRequired() {
  return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
}

function mapFace(row: KnownFaceRow): KnownFace {
  return {
    id: row.id,
    displayName: row.display_name,
    imageUrl: row.image_url || undefined,
    rekognitionFaceId: row.rekognition_face_id || undefined,
    isActive: row.is_active,
    addedAt: row.added_at,
  };
}

// ---------------------------------------------------------------------------
// GET — list active known faces
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// POST — register a new face (+ AWS Rekognition IndexFaces)
// ---------------------------------------------------------------------------

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

  if (!safeImageBase64) {
    return NextResponse.json({ ok: false, error: 'Vui lòng chọn ảnh gương mặt.' }, { status: 422 });
  }
  if (safeImageBase64.length > MAX_FACE_DATA_URL_LENGTH) {
    return NextResponse.json({ ok: false, error: 'Image is too large' }, { status: 413 });
  }
  if (!isRekognitionConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'AWS Rekognition chưa được cấu hình. Gương mặt chưa được lưu.' },
      { status: 503 },
    );
  }

  // ── Step 1: Upload image to Supabase Storage ──────────────────────────
  let storedImage = null;
  try {
    storedImage = await uploadDataUrlToStorage({
      dataUrl: safeImageBase64,
      folder: 'known-faces',
      deviceId: DEVICE_ID,
      namePrefix: displayName.trim(),
      maxBytes: MAX_FACE_IMAGE_BYTES,
      metadata: { display_name: displayName.trim() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cannot upload face image';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  // ── Step 2: Insert row into known_faces (rekognition_face_id = NULL) ──
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

  // ── Step 3: AWS Rekognition IndexFaces ─────────────────────────────────
  // Each database UUID becomes a different ExternalImageId. This deliberately
  // allows several images of the same person to contribute separate face
  // vectors to the collection.
  const base64Match = safeImageBase64.match(DATA_URL_PATTERN);
  const imageBuffer = base64Match ? Buffer.from(base64Match[1], 'base64') : null;
  if (!imageBuffer?.length) {
    await supabase.from('known_faces').delete().eq('id', data.id);
    await removeStorageObject(storedImage.bucket, storedImage.path).catch(() => {});
    return NextResponse.json({ ok: false, error: 'Dữ liệu ảnh không hợp lệ.' }, { status: 422 });
  }

  let indexedFaceId: string | null = null;
  try {
    const rekResult = await indexFace(imageBuffer, data.id);
    indexedFaceId = rekResult.faceId;

    if (!indexedFaceId) {
      let errorText = rekResult.errorMessage || 'Không phát hiện khuôn mặt đạt chuẩn trong ảnh. Vui lòng chụp rõ thẳng mặt.';
      if (!rekResult.errorMessage && rekResult.unindexedReasons?.length) {
        const reasonMap: Record<string, string> = {
          EXTREME_POSE: 'Khuôn mặt bị nghiêng, xoay hoặc che khuất (đội nón, cúi đầu)',
          LOW_SHARPNESS: 'Ảnh khuôn mặt bị mờ nhòe',
          LOW_BRIGHTNESS: 'Ảnh khuôn mặt bị quá tối',
          SHADOW: 'Khuôn mặt bị bóng râm che khuất',
          SMALL_BOUNDING_BOX: 'Khuôn mặt trong ảnh quá nhỏ',
          LOW_CONFIDENCE: 'Độ nhận diện khuôn mặt quá thấp',
        };
        const translatedReasons = rekResult.unindexedReasons
          .map((reason) => reasonMap[reason] || reason)
          .join(', ');
        errorText = `Ảnh bị từ chối do: ${translatedReasons}. Vui lòng nhìn thẳng và chụp rõ mặt.`;
      }
      throw Object.assign(new Error(errorText), { status: 422 });
    }

    const { error: updateError } = await supabase
      .from('known_faces')
      .update({ rekognition_face_id: indexedFaceId })
      .eq('id', data.id);
    if (updateError) {
      throw new Error(`Không thể liên kết FaceId vào Supabase: ${updateError.message}`);
    }

    return NextResponse.json({
      ok: true,
      face: mapFace({ ...data, rekognition_face_id: indexedFaceId }),
    }, { status: 201 });
  } catch (rekError) {
    console.error('[API /faces] Face registration failed:', rekError);
    if (indexedFaceId) {
      await deleteFace(indexedFaceId).catch((cleanupError) => {
        console.error('[API /faces] Failed to roll back indexed AWS face:', cleanupError);
      });
    }
    await supabase.from('known_faces').delete().eq('id', data.id);
    await removeStorageObject(storedImage.bucket, storedImage.path).catch((cleanupError) => {
      console.error('[API /faces] Failed to roll back stored face image:', cleanupError);
    });
    const message = rekError instanceof Error ? rekError.message : 'AWS Rekognition error';
    const status = typeof rekError === 'object' && rekError !== null && 'status' in rekError
      ? Number(rekError.status) || 500
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

// ---------------------------------------------------------------------------
// DELETE — deactivate a face (+ AWS Rekognition DeleteFaces)
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
  }
  if (!isSupabaseConfigured) return databaseRequired();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 422 });

  // Fetch the existing row to get Storage and Rekognition references
  const { data: face, error: faceError } = await supabase
    .from('known_faces')
    .select('image_bucket,image_path,rekognition_face_id')
    .eq('device_id', DEVICE_ID)
    .eq('id', id)
    .maybeSingle();

  if (faceError) return NextResponse.json({ ok: false, error: faceError.message }, { status: 400 });

  // ── Step 1: Remove face from AWS Rekognition collection ───────────────
  let rekognitionDeleted = true;
  if (face?.rekognition_face_id && isRekognitionConfigured()) {
    try {
      await deleteFace(face.rekognition_face_id);
    } catch (rekError) {
      rekognitionDeleted = false;
      console.error('[API /faces] Failed to remove face from Rekognition:', rekError);
    }
  }

  // ── Step 2: Soft-delete the DB row ────────────────────────────────────
  const { error } = await supabase
    .from('known_faces')
    .update({
      is_active: false,
      rekognition_face_id: null,
      image_url: null,
      image_bucket: null,
      image_path: null,
      image_mime_type: null,
      image_bytes: null,
    })
    .eq('device_id', DEVICE_ID)
    .eq('id', id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  // ── Step 3: Remove image from Supabase Storage ────────────────────────
  let storageDeleted = true;
  await removeStorageObject(face?.image_bucket, face?.image_path).catch((cleanupError) => {
    storageDeleted = false;
    console.error('[API /faces] Failed to remove face image from Storage:', cleanupError);
  });

  return NextResponse.json({ ok: true, storageDeleted, rekognitionDeleted });
}
