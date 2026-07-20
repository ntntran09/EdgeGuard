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

  if (safeImageBase64 && safeImageBase64.length > MAX_FACE_DATA_URL_LENGTH) {
    return NextResponse.json({ ok: false, error: 'Image is too large' }, { status: 413 });
  }

  // ── Step 1: Upload image to Supabase Storage ──────────────────────────
  let storedImage = null;
  if (safeImageBase64) {
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
  // When AWS is configured and an image was provided, index the face into
  // the Rekognition collection. If no face is detected, roll back the DB
  // row and the Storage object so the user gets clear feedback.
  if (safeImageBase64 && isRekognitionConfigured) {
    const base64Match = safeImageBase64.match(DATA_URL_PATTERN);
    const imageBuffer = base64Match
      ? Buffer.from(base64Match[1], 'base64')
      : null;

    if (imageBuffer && imageBuffer.length > 0) {
      try {
        const rekResult = await indexFace(imageBuffer, data.id);

        if (rekResult.faceId) {
          // Face detected — persist the Rekognition FaceId
          const { error: updateError } = await supabase
            .from('known_faces')
            .update({ rekognition_face_id: rekResult.faceId })
            .eq('id', data.id);

          if (updateError) {
            console.error('[API /faces] Failed to save rekognition_face_id:', updateError);
          }

          return NextResponse.json({
            ok: true,
            face: mapFace({
              ...data,
              rekognition_face_id: rekResult.faceId,
            }),
          }, { status: 201 });
        }

        // No face detected or rejected by quality/pose filter — roll back everything
        await supabase.from('known_faces').delete().eq('id', data.id);
        if (storedImage) {
          await removeStorageObject(storedImage.bucket, storedImage.path).catch(() => {});
        }

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
            .map((r) => reasonMap[r] || r)
            .join(', ');
          errorText = `Ảnh bị từ chối do: ${translatedReasons}. Vui lòng nhìn thẳng và chụp rõ mặt.`;
        }

        return NextResponse.json(
          { ok: false, error: errorText },
          { status: 422 },
        );
      } catch (rekError) {
        // Rekognition API error — roll back
        console.error('[API /faces] AWS Rekognition IndexFaces failed:', rekError);
        await supabase.from('known_faces').delete().eq('id', data.id);
        if (storedImage) {
          await removeStorageObject(storedImage.bucket, storedImage.path).catch(() => {});
        }
        const message = rekError instanceof Error
          ? rekError.message
          : 'AWS Rekognition error';
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
      }
    }
  }

  // AWS not configured or no image — return the row as-is (no face indexing)
  return NextResponse.json({ ok: true, face: mapFace(data) }, { status: 201 });
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
  if (face?.rekognition_face_id && isRekognitionConfigured) {
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
