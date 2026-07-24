import { parseEdgeImpulsePayload } from "./schemas";
import type { Box, NormalizedDataset, NormalizedSample, Prediction } from "./types";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === "string" && value.trim().length > 0);

const identifierValue = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
};

const finiteNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
};

function arrayAt(record: UnknownRecord, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

function parseBox(value: unknown): Box | null {
  if (typeof value === "string" && value.trim()) return { label: value };
  if (!isRecord(value)) return null;
  const label = stringValue(value.label, value.class, value.name, value.className);
  if (!label) return null;
  return {
    label,
    x: finiteNumber(value.x, value.xMin),
    y: finiteNumber(value.y, value.yMin),
    width: finiteNumber(value.width, value.w),
    height: finiteNumber(value.height, value.h),
    cX: finiteNumber(value.cX, value.cx, value.c_x, value.C_X, value.centerX, value.centroidX),
    cY: finiteNumber(value.cY, value.cy, value.c_y, value.C_Y, value.centerY, value.centroidY),
  };
}

function parsePrediction(value: unknown): Prediction | null {
  const box = parseBox(value);
  if (!box || !isRecord(value)) return null;
  const score = finiteNumber(value.score, value.confidence, value.value, value.probability);
  if (score === undefined) return null;
  return { ...box, score };
}

const PREDICTION_BRANCHES = new Set([
  "predictions",
  "boundingBoxes",
  "bounding_boxes",
  "boxes",
  "detections",
]);

const SKIPPED_PREDICTION_BRANCHES = new Set([
  "sample",
  "groundTruth",
  "ground_truth",
  "groundTruthBoxes",
  "expectedLabels",
  "thresholds",
]);

function collectPredictions(root: UnknownRecord): Prediction[] {
  const predictions: Prediction[] = [];
  const visited = new Set<unknown>();

  const visit = (value: unknown, parentKey = "", depth = 0) => {
    if (depth > 10 || value === null || value === undefined || visited.has(value)) return;
    if (typeof value === "object") visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        if (PREDICTION_BRANCHES.has(parentKey)) {
          const prediction = parsePrediction(item);
          if (prediction) predictions.push(prediction);
        }
        visit(item, parentKey, depth + 1);
      }
      return;
    }
    if (!isRecord(value)) return;

    const directPrediction = parsePrediction(value);
    if (directPrediction && !SKIPPED_PREDICTION_BRANCHES.has(parentKey)) {
      predictions.push(directPrediction);
    }

    if (/labelMapPredictions/i.test(parentKey)) {
      for (const [label, scoreValue] of Object.entries(value)) {
        const score = finiteNumber(scoreValue);
        if (score !== undefined) predictions.push({ label, score });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (SKIPPED_PREDICTION_BRANCHES.has(key)) continue;
      visit(child, key, depth + 1);
    }
  };

  visit(root);
  const unique = new Map<string, Prediction>();
  for (const prediction of predictions) {
    const key = [
      prediction.label,
      prediction.score,
      prediction.x ?? "",
      prediction.y ?? "",
      prediction.width ?? "",
      prediction.height ?? "",
      prediction.cX ?? "",
      prediction.cY ?? "",
    ].join("|");
    unique.set(key, prediction);
  }
  return [...unique.values()];
}

function nestedObject(record: UnknownRecord, keys: string[]): UnknownRecord | undefined {
  for (const key of keys) if (isRecord(record[key])) return record[key];
  return undefined;
}

function findSampleArray(root: UnknownRecord): unknown[] {
  const direct = arrayAt(root, ["samples", "result", "results", "data", "items"]);
  if (direct.length) return direct;
  const nested = nestedObject(root, ["result", "structuredResult", "modelTestingResults"]);
  return nested ? arrayAt(nested, ["samples", "results", "data", "items"]) : [];
}

function labelsFrom(root: UnknownRecord): string[] {
  const values = arrayAt(root, ["labels", "classes", "modelLabels"]);
  return values
    .map((value) => (typeof value === "string" ? value : isRecord(value) ? stringValue(value.label, value.name) : undefined))
    .filter((value): value is string => Boolean(value));
}

function variantsFrom(root: UnknownRecord): string[] {
  const values = arrayAt(root, ["availableVariants", "variants", "modelVariants"]);
  return values
    .map((value) =>
      typeof value === "string" ? value : isRecord(value) ? stringValue(value.variant, value.name, value.type) : undefined,
    )
    .filter((value): value is string => Boolean(value));
}

function isNormalizedCoordinate(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function scaleNormalizedBox<T extends Box>(
  box: T,
  dimensions: { width?: number; height?: number } | undefined,
): T {
  const imageWidth = finiteNumber(dimensions?.width);
  const imageHeight = finiteNumber(dimensions?.height);
  if (!imageWidth || !imageHeight) return box;
  const next: T = { ...box };
  if (
    isNormalizedCoordinate(box.x) &&
    isNormalizedCoordinate(box.y) &&
    isNormalizedCoordinate(box.width) &&
    isNormalizedCoordinate(box.height)
  ) {
    next.x = box.x * imageWidth;
    next.y = box.y * imageHeight;
    next.width = box.width * imageWidth;
    next.height = box.height * imageHeight;
  }
  if (isNormalizedCoordinate(box.cX)) next.cX = box.cX * imageWidth;
  if (isNormalizedCoordinate(box.cY)) next.cY = box.cY * imageHeight;
  return next;
}

function labelsFromSamples(samples: NormalizedSample[]): string[] {
  return samples.flatMap((sample) => [
    ...sample.groundTruthBoxes.map((box) => box.label),
    ...sample.predictions.map((prediction) => prediction.label),
  ]);
}

function normalizeSample(value: unknown, index: number, defaultCategory: string): NormalizedSample | null {
  if (!isRecord(value)) return null;
  const sample = isRecord(value.sample) ? value.sample : value;
  const id = identifierValue(sample.id, sample.sampleId, value.sampleId, value.id) ?? String(index + 1);
  const filename =
    stringValue(sample.filename, sample.name, value.filename, value.name) ?? `sample-${index + 1}`;
  const category = stringValue(sample.category, value.category) ?? defaultCategory;
  const gtContainer = nestedObject(value, ["groundTruth", "ground_truth", "sample"]) ?? value;
  const groundTruthValues = arrayAt(gtContainer, [
    "groundTruthBoxes",
    "boundingBoxes",
    "boxes",
    "labels",
  ]);
  let predictions = collectPredictions(value);
  const predContainer = nestedObject(value, ["structuredResult", "result", "predictionResult"]) ?? value;
  if (!predictions.length) {
    const labels = arrayAt(predContainer, ["labels"]);
    const scores = arrayAt(predContainer, ["scores"]);
    if (labels.length && labels.length === scores.length) {
      predictions = labels
        .map((label, scoreIndex) => parsePrediction({ label, score: scores[scoreIndex] }))
        .filter((prediction): prediction is Prediction => prediction !== null);
    } else if (isRecord(predContainer.scores)) {
      predictions = Object.entries(predContainer.scores)
        .map(([label, score]) => parsePrediction({ label, score }))
        .filter((prediction): prediction is Prediction => prediction !== null);
    }
  }
  const dimensions = isRecord(sample.imageDimensions) ? sample.imageDimensions : undefined;
  const groundTruthBoxes = groundTruthValues
    .map(parseBox)
    .filter((box): box is Box => box !== null)
    .map((box) => scaleNormalizedBox(box, dimensions));
  predictions = predictions.map((prediction) => scaleNormalizedBox(prediction, dimensions));
  return {
    id,
    filename,
    category,
    groundTruthBoxes,
    predictions,
    imageSampleId: id,
    thumbnailUrl: stringValue(
      sample.thumbnailUrl,
      sample.thumbnail,
      sample.thumbnailVideoFull,
      sample.thumbnailVideo,
      sample.imageUrl,
      sample.imageUrlFull,
      sample.videoUrl,
      sample.videoUrlFull,
      value.thumbnailUrl,
      value.thumbnail,
      value.thumbnailVideoFull,
      value.thumbnailVideo,
      value.imageUrl,
      value.imageUrlFull,
      value.videoUrl,
      value.videoUrlFull,
    ),
    imageWidth: finiteNumber(dimensions?.width, sample.imageWidth, value.imageWidth),
    imageHeight: finiteNumber(dimensions?.height, sample.imageHeight, value.imageHeight),
  };
}

export function normalizeEdgeImpulseResponse(payload: unknown, defaultCategory = "testing"): NormalizedDataset {
  const root = parseEdgeImpulsePayload(payload);
  const rawSamples = findSampleArray(root);
  if (!rawSamples.length) {
    throw new Error(
      "Dữ liệu Edge Impulse không đúng cấu trúc hoặc không chứa sample đánh giá. Hãy chạy Model testing → Classify all rồi thử lại.",
    );
  }
  const rootPredictionEntries = arrayAt(root, ["predictions"]);
  const rootPredictionsBySampleId = new Map<string, UnknownRecord>();
  for (const entry of rootPredictionEntries) {
    if (!isRecord(entry)) continue;
    const sampleId = identifierValue(entry.sampleId, entry.id);
    if (sampleId) rootPredictionsBySampleId.set(sampleId, entry);
  }
  const samples = rawSamples
    .map((sample, index) => {
      if (!isRecord(sample)) return normalizeSample(sample, index, defaultCategory);
      const nestedSample = isRecord(sample.sample) ? sample.sample : undefined;
      const sampleId = identifierValue(
        sample.sampleId,
        sample.id,
        nestedSample?.sampleId,
        nestedSample?.id,
      );
      const rootPrediction = sampleId ? rootPredictionsBySampleId.get(sampleId) : undefined;
      return normalizeSample(
        rootPrediction ? { ...sample, rootPrediction } : sample,
        index,
        defaultCategory,
      );
    })
    .filter((sample): sample is NormalizedSample => sample !== null);
  if (!samples.length) throw new Error("Không thể đọc sample hợp lệ từ dữ liệu Edge Impulse.");
  const nested = nestedObject(root, ["result", "structuredResult", "modelTestingResults"]);
  const classes = [
    ...new Set([
      ...labelsFrom(root),
      ...(nested ? labelsFrom(nested) : []),
      ...labelsFromSamples(samples),
    ]),
  ];
  const availableVariants = [...new Set([...variantsFrom(root), ...(nested ? variantsFrom(nested) : [])])];
  const warnings: string[] = [];
  if (root.noResultsBecauseThresholdsChanged) {
    warnings.push("Threshold của mô hình đã thay đổi. Hãy chạy lại Classify all để có kết quả đồng nhất.");
  }
  if (root.can_regenerate_model_summary) {
    warnings.push("Edge Impulse cho phép tạo lại model summary trước khi đánh giá.");
  }
  if (root.should_rerun_full_job) {
    warnings.push("Edge Impulse khuyến nghị chạy lại toàn bộ tác vụ Model Testing.");
  }
  const accuracy = nestedObject(root, ["accuracy"]);
  const upstreamAccuracy = accuracy
    ? finiteNumber(accuracy.accuracyScore, accuracy.accuracy, accuracy.f1Score)
    : undefined;
  const totalPredictions = samples.reduce((sum, sample) => sum + sample.predictions.length, 0);
  if (totalPredictions === 0 && upstreamAccuracy !== undefined && upstreamAccuracy > 0) {
    throw new Error(
      "Edge Impulse báo model có kết quả dương nhưng ứng dụng không đọc được prediction nào. Cấu trúc payload prediction chưa được hỗ trợ; báo cáo đã bị dừng để tránh hiển thị metric sai.",
    );
  }
  return { samples, classes, availableVariants, warnings };
}
