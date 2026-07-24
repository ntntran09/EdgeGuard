import type { AiDetection } from '@/types';

export const AI_MIN_CONFIDENCE = 0.7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function normalizeAiDetections(payload: unknown): AiDetection[] {
  if (!isRecord(payload) || !Array.isArray(payload.detections)) return [];

  const inputWidth = finiteNumber(payload.input_width) || 96;
  const inputHeight = finiteNumber(payload.input_height) || 96;
  const hasPerson = payload.detections.some((value) => (
    isRecord(value)
    && (
      value.type === 'person'
      || value.label === 'person'
      || value.label === 'human'
    )
    && (finiteNumber(value.confidence) ?? 0) > AI_MIN_CONFIDENCE
  ));

  return payload.detections.flatMap((value) => {
    if (!isRecord(value)) return [];

    const confidence = finiteNumber(value.confidence);
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    const width = finiteNumber(value.width);
    const height = finiteNumber(value.height);
    const isFaceBox = typeof value.type === 'string' && value.type.startsWith('face_');
    const isPerson = value.type === 'person' || value.label === 'person' || value.label === 'human';
    if (
      confidence === undefined
      || (!isFaceBox && confidence <= AI_MIN_CONFIDENCE)
      || (hasPerson && !isPerson && !isFaceBox)
      || x === undefined
      || y === undefined
      || width === undefined
      || height === undefined
    ) {
      return [];
    }

    const centroidX = finiteNumber(value.centroid_x) ?? x + width / 2;
    const centroidY = finiteNumber(value.centroid_y) ?? y + height / 2;

    return [{
      label: typeof value.label === 'string' ? value.label : 'unknown',
      type: typeof value.type === 'string' ? value.type : 'object',
      confidence,
      x,
      y,
      width,
      height,
      centroidX: Math.min(inputWidth, Math.max(0, centroidX)),
      centroidY: Math.min(inputHeight, Math.max(0, centroidY)),
      inputWidth,
      inputHeight,
    }];
  });
}
