import { RekognitionClient, SearchFacesByImageCommand, IndexFacesCommand, DeleteFacesCommand, DetectFacesCommand } from '@aws-sdk/client-rekognition';
import sharp from 'sharp';
import { config } from '../config.js';

const isRekognitionConfigured = Boolean(
  config.aws.accessKeyId && config.aws.secretAccessKey && config.aws.rekognitionCollectionId
);

let client = null;
function getClient() {
  if (!client) {
    client = new RekognitionClient({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }
  return client;
}

function extractBuffer(input) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === 'string') {
    const match = input.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) {
      return Buffer.from(match[2], 'base64');
    }
    try {
      return Buffer.from(input, 'base64');
    } catch (e) {
      return null;
    }
  }
  return null;
}

export const rekognitionService = {
  /**
   * Analyze an image, detect up to 3 faces, crop them, and search each against the collection.
   * Returns an array of face match results.
   */
  async analyzeFrame(input, threshold = 75) {
    if (!isRekognitionConfigured) {
      console.warn('[Rekognition Service] Skipped analyzeFrame: AWS not configured.');
      return [];
    }

    const imageBuffer = extractBuffer(input);
    if (!imageBuffer) return [];

    try {
      // 1. Detect all faces
      const detectResult = await getClient().send(new DetectFacesCommand({
        Image: { Bytes: imageBuffer }
      }));

      if (!detectResult.FaceDetails || detectResult.FaceDetails.length === 0) {
        return [];
      }

      // 2. Sort by largest area and take top 3
      const faces = detectResult.FaceDetails
        .map(face => face.BoundingBox)
        .filter(Boolean)
        .sort((a, b) => (b.Width * b.Height) - (a.Width * a.Height))
        .slice(0, 3);

      const metadata = await sharp(imageBuffer).metadata();
      const imgWidth = metadata.width;
      const imgHeight = metadata.height;

      const results = [];

      // 3. For each face, crop and search
      for (const bbox of faces) {
        let left = Math.floor(bbox.Left * imgWidth);
        let top = Math.floor(bbox.Top * imgHeight);
        let boxWidth = Math.floor(bbox.Width * imgWidth);
        let boxHeight = Math.floor(bbox.Height * imgHeight);

        // Add 20px padding (expand slightly)
        const margin = 20;
        left = Math.max(0, left - margin);
        top = Math.max(0, top - margin);
        const right = Math.min(imgWidth, left + boxWidth + 2 * margin);
        const bottom = Math.min(imgHeight, top + boxHeight + 2 * margin);
        
        boxWidth = right - left;
        boxHeight = bottom - top;

        const croppedBuffer = await sharp(imageBuffer)
          .extract({ left, top, width: boxWidth, height: boxHeight })
          .jpeg()
          .toBuffer();

        // 4. Search the cropped face
        const searchRes = await this.searchFace(croppedBuffer, threshold);
        // Attach the original full-image BoundingBox to the result so it can be rendered
        searchRes.boundingBox = bbox;
        results.push(searchRes);
      }

      return results;
    } catch (error) {
      console.error('[Rekognition Service] analyzeFrame failed:', error);
      return [];
    }
  },

  /**
   * Search for a face in the Rekognition collection.
   * Uses QualityFilter: 'AUTO' (NOT 'HIGH') so real-time camera frames can match.
   */
  async searchFace(input, threshold = 75) {
    if (!isRekognitionConfigured) {
      console.warn('[Rekognition Service] Skipped searchFace: AWS not configured.');
      return { matched: false, faceId: null, similarity: 0, externalImageId: null };
    }

    const imageBuffer = extractBuffer(input);
    if (!imageBuffer) {
      return { matched: false, faceId: null, similarity: 0, externalImageId: null };
    }

    try {
      const result = await getClient().send(new SearchFacesByImageCommand({
        CollectionId: config.aws.rekognitionCollectionId,
        Image: { Bytes: imageBuffer },
        MaxFaces: 1,
        FaceMatchThreshold: threshold,
        QualityFilter: 'AUTO', // IMPORTANT: Using AUTO instead of HIGH for camera stream inference
      }));

      const match = result.FaceMatches?.[0];
      return {
        matched: Boolean(match),
        faceId: match?.Face?.FaceId || null,
        similarity: match?.Similarity || 0,
        externalImageId: match?.Face?.ExternalImageId || null,
        boundingBox: result.SearchedFaceBoundingBox || null,
      };
    } catch (error) {
      console.error('[Rekognition Service] SearchFacesByImage failed:', error.message);
      return { matched: false, faceId: null, similarity: 0, externalImageId: null, error: error.message };
    }
  },

  async indexFace(imageBuffer, externalImageId) {
    if (!isRekognitionConfigured) return { faceId: null, confidence: 0 };
    const buffer = extractBuffer(imageBuffer);
    if (!buffer) return { faceId: null, confidence: 0 };

    const result = await getClient().send(new IndexFacesCommand({
      CollectionId: config.aws.rekognitionCollectionId,
      Image: { Bytes: buffer },
      ExternalImageId: externalImageId,
      MaxFaces: 1,
      DetectionAttributes: ['DEFAULT'],
      QualityFilter: 'HIGH',
    }));
    const face = result.FaceRecords?.[0]?.Face;
    return { faceId: face?.FaceId || null, confidence: face?.Confidence || 0 };
  },

  async deleteFace(faceId) {
    if (!isRekognitionConfigured || !faceId) return;
    await getClient().send(new DeleteFacesCommand({
      CollectionId: config.aws.rekognitionCollectionId,
      FaceIds: [faceId],
    }));
  },
};
