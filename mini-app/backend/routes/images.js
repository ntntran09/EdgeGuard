import path from 'node:path';

import { Router } from 'express';

import { config } from '../config.js';
import {
  listSavedImages,
  metadataPathFor,
  saveImageFromJson,
  safeImageFilename,
} from '../services/image-store.js';

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
      const result = await saveImageFromJson(request.body, {
        source: 'http',
        topic: 'http:/api/images',
      });

      response.status(201).json({ ok: true, image: result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
