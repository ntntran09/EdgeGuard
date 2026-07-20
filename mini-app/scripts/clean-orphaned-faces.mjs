import { RekognitionClient, DeleteFacesCommand } from '@aws-sdk/client-rekognition';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const region = process.env.AWS_REGION || 'ap-southeast-1';
const collectionId = process.env.AWS_REKOGNITION_COLLECTION_ID || 'frontdoor';

const rekClient = new RekognitionClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const orphanedFaceIds = [
  '3a479e83-1a52-4f17-b897-365e3317ece6',
  'd5e7d524-578c-402f-b064-d5e49f5f7341',
];

async function clean() {
  console.log(`\n🧹 Đang xóa ${orphanedFaceIds.length} FaceId mồ côi khỏi collection "${collectionId}"...`);

  const res = await rekClient.send(
    new DeleteFacesCommand({
      CollectionId: collectionId,
      FaceIds: orphanedFaceIds,
    })
  );

  console.log(`✅ Đã xoá thành công FaceIds:`, res.DeletedFaces);
  if (res.UnsuccessfulFaceDeletions?.length) {
    console.warn(`⚠️ Xóa thất bại:`, res.UnsuccessfulFaceDeletions);
  }
}

clean().catch(console.error);
