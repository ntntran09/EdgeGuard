import path from 'node:path';

import { Router } from 'express';

import { config } from '../config.js';
import {
  createTransientImageFromJson,
  listSavedImages,
  metadataPathFor,
  safeImageFilename,
} from '../services/image-store.js';
import { supabaseService } from '../services/supabase-service.js';

export function createImagesRouter() {
  const router = Router();

  router.get('/', async (_request, response, next) => {
    try {
      response.json({ images: await listSavedImages() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:filename', async (request, response) => {
    const filename = safeImageFilename(request.params.filename);

    if (!filename) {
      response.status(404).json({ error: 'Image not found.' });
      return;
    }

    response.sendFile(path.join(config.images.storageDir, filename));
  });

  router.get('/:filename/metadata', async (request, response) => {
    const filename = safeImageFilename(request.params.filename);

    if (!filename) {
      response.status(404).json({ error: 'Image not found.' });
      return;
    }

    response.sendFile(metadataPathFor(filename));
  });

  router.post('/', async (request, response, next) => {
    try {
      const image = createTransientImageFromJson(request.body, {
        source: 'http',
        topic: 'http:/api/images',
      });
      const result = await supabaseService.prepareImageReference({
        deviceId: request.body.device_id ?? request.body.deviceId ?? config.mqtt.deviceId,
        imagePath: image.base64,
        folder: 'manual-uploads',
        metadata: {
          source: 'http',
          original_filename: request.body.filename,
        },
      });

      if (result.imageMetadata.image_storage_mode !== 'supabase_storage') {
        throw new Error(result.imageMetadata.image_storage_error || 'Image could not be uploaded to Supabase Storage.');
      }
      const imageRow = await supabaseService.recordStoredImageReference({
        deviceId: request.body.device_id ?? request.body.deviceId ?? config.mqtt.deviceId,
        imageReference: result,
        metadata: { source: 'manual_upload', original_filename: request.body.filename },
      });

      response.status(201).json({
        ok: true,
        image: {
          id: imageRow.id,
          url: result.thumbnailUrl,
          bucket: result.imageMetadata.image_bucket,
          path: result.imageMetadata.image_path,
          contentType: result.imageMetadata.image_content_type,
          bytes: result.imageMetadata.image_bytes,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
