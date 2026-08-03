import type { Box } from "@/lib/edge-impulse/types";

export type ImageSize = { width: number; height: number };

export function hasDrawableCoordinates(
  box: Box,
): box is Box & { x: number; y: number; width: number; height: number } {
  return [box.x, box.y, box.width, box.height].every(
    (value) => typeof value === "number" && Number.isFinite(value),
  ) && (box.width ?? 0) > 0 && (box.height ?? 0) > 0;
}

export function hasDrawableCentroid(box: Box): box is Box & { cX: number; cY: number } {
  return [box.cX, box.cY].every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

export function getBoxCentroid(box: Box): { x: number; y: number } | null {
  if (hasDrawableCentroid(box)) return { x: box.cX, y: box.cY };
  if (!hasDrawableCoordinates(box)) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function transformBoxContain(box: Box, source: ImageSize, target: ImageSize): Box {
  if (!hasDrawableCoordinates(box) || source.width <= 0 || source.height <= 0) return box;
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const renderedWidth = source.width * scale;
  const renderedHeight = source.height * scale;
  const offsetX = (target.width - renderedWidth) / 2;
  const offsetY = (target.height - renderedHeight) / 2;
  return {
    ...box,
    x: box.x * scale + offsetX,
    y: box.y * scale + offsetY,
    width: box.width * scale,
    height: box.height * scale,
    cX: box.cX === undefined ? undefined : box.cX * scale + offsetX,
    cY: box.cY === undefined ? undefined : box.cY * scale + offsetY,
  };
}

export function transformBoxFromContain(box: Box, source: ImageSize, target: ImageSize): Box {
  if (source.width <= 0 || source.height <= 0 || target.width <= 0 || target.height <= 0) return box;
  const scale = Math.min(target.width / source.width, target.height / source.height);
  if (scale <= 0) return box;
  const renderedWidth = source.width * scale;
  const renderedHeight = source.height * scale;
  const offsetX = (target.width - renderedWidth) / 2;
  const offsetY = (target.height - renderedHeight) / 2;

  const next: Box = { ...box };
  if (hasDrawableCoordinates(box)) {
    next.x = (box.x - offsetX) / scale;
    next.y = (box.y - offsetY) / scale;
    next.width = box.width / scale;
    next.height = box.height / scale;
  }
  if (hasDrawableCentroid(box)) {
    next.cX = (box.cX - offsetX) / scale;
    next.cY = (box.cY - offsetY) / scale;
  }
  return next;
}
