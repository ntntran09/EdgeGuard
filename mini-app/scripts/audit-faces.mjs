import { RekognitionClient, ListFacesCommand } from '@aws-sdk/client-rekognition';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables from mini-app/.env
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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  console.log(`\n======================================================`);
  console.log(`🔍 AUDIT: AWS Rekognition (${collectionId}) vs Supabase DB`);
  console.log(`======================================================\n`);

  // 1. Fetch all faces from AWS Rekognition collection
  const awsFaces = [];
  let nextToken = undefined;
  do {
    const res = await rekClient.send(
      new ListFacesCommand({
        CollectionId: collectionId,
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    if (res.Faces) awsFaces.push(...res.Faces);
    nextToken = res.NextToken;
  } while (nextToken);

  console.log(`✅ [AWS Rekognition] Tìm thấy ${awsFaces.length} khuôn mặt trong collection "${collectionId}".`);

  // 2. Fetch all known_faces from Supabase DB
  const { data: dbFaces, error } = await supabase
    .from('known_faces')
    .select('id, display_name, rekognition_face_id, is_active');

  if (error) {
    console.error(`❌ Lỗi truy vấn Supabase:`, error.message);
    process.exit(1);
  }

  console.log(`✅ [Supabase DB]    Tìm thấy ${dbFaces.length} bản ghi trong bảng "known_faces".\n`);

  // 3. Map DB rekognition_face_ids
  const dbFaceIdMap = new Map();
  dbFaces.forEach(row => {
    if (row.rekognition_face_id) {
      dbFaceIdMap.set(row.rekognition_face_id, row);
    }
  });

  // 4. Find Orphaned AWS faces (exist in AWS but not active in DB)
  const orphanedFaces = awsFaces.filter(face => !dbFaceIdMap.has(face.FaceId));
  const matchedFaces = awsFaces.filter(face => dbFaceIdMap.has(face.FaceId));

  console.log(`------------------------------------------------------`);
  console.log(`📌 KẾT QUẢ ĐỐI CHIẾU:`);
  console.log(`   - Khớp giữa AWS & DB: ${matchedFaces.length} khuôn mặt`);
  console.log(`   - Mồ côi (Có trên AWS nhưng KHÔNG CÓ/KHÔNG KHỚP trong DB): ${orphanedFaces.length} khuôn mặt`);
  console.log(`------------------------------------------------------\n`);

  if (orphanedFaces.length > 0) {
    console.log(`⚠️ DANH SÁCH FACEID MỒ CÔI TRÊN AWS "${collectionId}":`);
    console.table(orphanedFaces.map(f => ({
      FaceId: f.FaceId,
      ExternalImageId: f.ExternalImageId || '(Trống)',
      Confidence: `${Math.round(f.Confidence || 0)}%`,
    })));
  } else {
    console.log(`🎉 Tuyệt vời! Toàn bộ FaceId trên AWS đều khớp 100% với database Supabase.`);
  }

  // Also check if any DB records point to a non-existent AWS FaceId
  const awsFaceIdSet = new Set(awsFaces.map(f => f.FaceId));
  const missingInAws = dbFaces.filter(row => row.is_active && row.rekognition_face_id && !awsFaceIdSet.has(row.rekognition_face_id));
  if (missingInAws.length > 0) {
    console.log(`\n⚠️ DANH SÁCH BẢNG GHI DB ĐANG TRỎ TỚI FACEID KHÔNG TỒN TẠI TRÊN AWS:`);
    console.table(missingInAws.map(r => ({
      DB_Id: r.id,
      DisplayName: r.display_name,
      RekognitionFaceId: r.rekognition_face_id,
    })));
  }
}

audit().catch(err => {
  console.error(`❌ Audit failed:`, err);
});
