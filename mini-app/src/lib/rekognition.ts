import 'server-only';

import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
  DeleteFacesCommand,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function currentRegion(): string {
  return process.env.AWS_REGION || 'ap-southeast-1';
}

function currentCollectionId(): string {
  return process.env.AWS_REKOGNITION_COLLECTION_ID || 'edgeguard-faces';
}

export function isRekognitionConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let client: RekognitionClient | null = null;
let readyCollectionId: string | null = null;

function getClient(): RekognitionClient {
  if (!client) {
    client = new RekognitionClient({
      region: currentRegion(),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

/**
 * Create the Rekognition face collection if it does not already exist.
 * Called lazily on the first API call so the app still boots when AWS
 * credentials are missing.
 */
async function ensureCollection(): Promise<void> {
  const collectionId = currentCollectionId();
  if (readyCollectionId === collectionId) return;

  try {
    await getClient().send(
      new CreateCollectionCommand({ CollectionId: collectionId }),
    );
    console.log(`[Rekognition] Created collection: ${collectionId}`);
  } catch (error: unknown) {
    const name = (error as { name?: string })?.name;
    if (name === 'ResourceAlreadyExistsException') {
      readyCollectionId = collectionId;
      return;
    }
    if (name === 'AccessDeniedException') {
      console.warn(`[Rekognition] AccessDenied on CreateCollection (${collectionId}). Assuming collection already exists.`);
      readyCollectionId = collectionId;
      return;
    }
    throw error;
  }

  readyCollectionId = collectionId;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IndexFaceResult {
  faceId: string | null;
  confidence: number;
  unindexedReasons?: string[];
  errorMessage?: string;
  boundingBox: {
    width: number;
    height: number;
    left: number;
    top: number;
  } | null;
}

/**
 * Index a single face into the Rekognition collection with strict quality checks.
 */
export async function indexFace(
  imageBuffer: Buffer,
  externalImageId: string,
): Promise<IndexFaceResult> {
  if (!isRekognitionConfigured()) {
    throw new Error('AWS Rekognition is not configured');
  }

  await ensureCollection();

  const result = await getClient().send(
    new IndexFacesCommand({
      CollectionId: currentCollectionId(),
      Image: { Bytes: imageBuffer },
      ExternalImageId: externalImageId,
      MaxFaces: 1,
      DetectionAttributes: ['ALL'],
      QualityFilter: 'HIGH',
    }),
  );

  const faceRecord = result.FaceRecords?.[0];
  const face = faceRecord?.Face;
  const detail = faceRecord?.FaceDetail;

  // Nếu AWS lọc bỏ khuôn mặt (do góc nhìn nghiêng, mờ, tối, hoặc bị che mất)
  if (!face?.FaceId) {
    const reasons = result.UnindexedFaces?.[0]?.Reasons || [];
    return {
      faceId: null,
      confidence: 0,
      unindexedReasons: reasons as string[],
      boundingBox: null,
    };
  }

  // Kiểm tra thêm độ tin cậy và góc quay mặt (Pose)
  const confidence = face.Confidence ?? 0;
  const yaw = Math.abs(detail?.Pose?.Yaw ?? 0);
  const pitch = Math.abs(detail?.Pose?.Pitch ?? 0);

  if (confidence < 90 || yaw > 25 || pitch > 25) {
    // Khuôn mặt có góc nghiêng/cúi ngẩng quá lớn (> 25 độ) hoặc độ tin cậy thấp -> Xóa ngay khỏi collection
    await getClient().send(
      new DeleteFacesCommand({
        CollectionId: currentCollectionId(),
        FaceIds: [face.FaceId],
      }),
    ).catch(() => {});

    let errorMessage = 'Khuôn mặt chưa đạt tiêu chuẩn.';
    if (yaw > 25 || pitch > 25) {
      errorMessage = `Góc mặt bị nghiêng hoặc cúi/ngẩng quá nhiều (Yaw: ${Math.round(yaw)}°, Pitch: ${Math.round(pitch)}°). Vui lòng nhìn thẳng vào camera.`;
    } else if (confidence < 90) {
      errorMessage = `Độ rõ ràng của khuôn mặt chưa đủ cao (${Math.round(confidence)}%). Vui lòng chụp nơi đủ ánh sáng và rõ mặt.`;
    }

    return {
      faceId: null,
      confidence,
      errorMessage,
      boundingBox: null,
    };
  }

  return {
    faceId: face.FaceId,
    confidence,
    boundingBox: face.BoundingBox
      ? {
          width: face.BoundingBox.Width ?? 0,
          height: face.BoundingBox.Height ?? 0,
          left: face.BoundingBox.Left ?? 0,
          top: face.BoundingBox.Top ?? 0,
        }
      : null,
  };
}

/**
 * Remove a previously indexed face from the Rekognition collection.
 *
 * @param faceId  The `FaceId` returned by a prior `indexFace` call.
 */
export async function deleteFace(faceId: string): Promise<void> {
  if (!isRekognitionConfigured()) {
    throw new Error('AWS Rekognition is not configured');
  }

  await getClient().send(
    new DeleteFacesCommand({
      CollectionId: currentCollectionId(),
      FaceIds: [faceId],
    }),
  );
}

export interface SearchFaceResult {
  matched: boolean;
  faceId: string | null;
  externalImageId: string | null;
  similarity: number;
}

/**
 * Search for a face in the Rekognition collection.
 * Uses QualityFilter: 'AUTO' and threshold 75% so tilted, dark, or profile
 * faces from the real-time camera stream can still match against registered faces.
 */
export async function searchFace(imageBuffer: Buffer, threshold = 75): Promise<SearchFaceResult> {
  if (!isRekognitionConfigured()) {
    throw new Error('AWS Rekognition is not configured');
  }

  await ensureCollection();

  try {
    const result = await getClient().send(
      new SearchFacesByImageCommand({
        CollectionId: currentCollectionId(),
        Image: { Bytes: imageBuffer },
        MaxFaces: 1,
        FaceMatchThreshold: threshold,
        QualityFilter: 'AUTO',
      }),
    );

    const match = result.FaceMatches?.[0];
    if (!match || !match.Face) {
      return { matched: false, faceId: null, externalImageId: null, similarity: 0 };
    }

    return {
      matched: true,
      faceId: match.Face.FaceId || null,
      externalImageId: match.Face.ExternalImageId || null,
      similarity: match.Similarity ?? 0,
    };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    // If no face is detected in the query image, AWS throws InvalidParameterException or returns no matches
    if (name === 'InvalidParameterException') {
      return { matched: false, faceId: null, externalImageId: null, similarity: 0 };
    }
    throw err;
  }
}
