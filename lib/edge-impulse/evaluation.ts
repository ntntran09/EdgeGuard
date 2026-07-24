import { SUPPORTED_LABEL_LIST } from "@/lib/constants/fomo";
import {
  buildShowClassificationUrl,
  EdgeImpulseError,
  getAllRawData,
  getModelTestingResults,
} from "@/lib/edge-impulse/client";
import { normalizeEdgeImpulseResponse } from "@/lib/edge-impulse/normalize";
import type { NormalizedDataset } from "@/lib/edge-impulse/types";
import type { ServerSession } from "@/lib/edge-impulse/session";

const SUPPORTED_LABEL_VALUES: readonly string[] = SUPPORTED_LABEL_LIST;

function filenameKey(filename: string): string {
  return filename.trim().toLowerCase().replace(/\\/g, "/").split("/").pop() ?? filename.trim().toLowerCase();
}

function browserImageUrl(sample: NormalizedDataset["samples"][number]): string {
  if (
    sample.thumbnailUrl &&
    (/^https?:\/\//.test(sample.thumbnailUrl) || sample.thumbnailUrl.startsWith("/demo/"))
  ) {
    return sample.thumbnailUrl;
  }
  return `/api/images/${encodeURIComponent(sample.imageSampleId ?? sample.id)}`;
}

function labelsInDataset(dataset: NormalizedDataset): string[] {
  return [
    ...new Set([
      ...dataset.classes,
      ...dataset.samples.flatMap((sample) => [
        ...sample.groundTruthBoxes.map((box) => box.label),
        ...sample.predictions.map((prediction) => prediction.label),
      ]),
    ]),
  ];
}

export function unsupportedClassWarnings(dataset: NormalizedDataset): string[] {
  const labels = labelsInDataset(dataset);
  return labels.some((label) => !SUPPORTED_LABEL_VALUES.includes(label))
    ? [
        "Dữ liệu chứa class không được hỗ trợ. Custom metric này chỉ hỗ trợ human, package và backpack.",
      ]
    : [];
}

export function assertRequiredClasses(dataset: NormalizedDataset): void {
  const labelSet = new Set(labelsInDataset(dataset));
  const missing = SUPPORTED_LABEL_LIST.filter((label) => !labelSet.has(label));
  if (missing.length) {
    throw new EdgeImpulseError(
      "Project không có đủ ba class bắt buộc: human, package và backpack.",
      "REQUIRED_LABELS_MISSING",
      400,
    );
  }
}

export async function loadEvaluationDataset(session: ServerSession): Promise<NormalizedDataset> {
  const credentials = { projectId: session.projectId, apiKey: session.apiKey };
  const payload = await getModelTestingResults(credentials);
  const normalized = normalizeEdgeImpulseResponse(payload, "testing");
  const needsGroundTruth = normalized.samples.every((sample) => sample.groundTruthBoxes.length === 0);
  if (needsGroundTruth) {
    const rawItems = await getAllRawData(credentials, "all");
    if (!rawItems.length) {
      throw new EdgeImpulseError(
        "Không thể tải dữ liệu Model Testing từ Edge Impulse.",
        "MODEL_TESTING_LOAD_FAILED",
        502,
      );
    }
    const rawDataset = normalizeEdgeImpulseResponse({ samples: rawItems }, "testing");
    const groundTruthById = new Map(rawDataset.samples.map((sample) => [sample.id, sample.groundTruthBoxes]));
    const groundTruthByName = new Map(rawDataset.samples.map((sample) => [sample.filename, sample.groundTruthBoxes]));
    const rawSampleById = new Map(rawDataset.samples.map((sample) => [sample.id, sample]));
    const rawSampleByName = new Map(rawDataset.samples.map((sample) => [sample.filename, sample]));
    const rawSampleByFilename = new Map(rawDataset.samples.map((sample) => [filenameKey(sample.filename), sample]));
    normalized.samples = normalized.samples.map((sample) => ({
      ...sample,
      groundTruthBoxes: groundTruthById.get(sample.id) ?? groundTruthByName.get(sample.filename) ?? [],
      imageSampleId: rawSampleById.get(sample.id)?.id ?? rawSampleByName.get(sample.filename)?.id ?? rawSampleByFilename.get(filenameKey(sample.filename))?.id ?? sample.imageSampleId,
      thumbnailUrl: sample.thumbnailUrl ?? rawSampleById.get(sample.id)?.thumbnailUrl ?? rawSampleByName.get(sample.filename)?.thumbnailUrl ?? rawSampleByFilename.get(filenameKey(sample.filename))?.thumbnailUrl,
      imageWidth: sample.imageWidth ?? rawSampleById.get(sample.id)?.imageWidth ?? rawSampleByName.get(sample.filename)?.imageWidth ?? rawSampleByFilename.get(filenameKey(sample.filename))?.imageWidth,
      imageHeight: sample.imageHeight ?? rawSampleById.get(sample.id)?.imageHeight ?? rawSampleByName.get(sample.filename)?.imageHeight ?? rawSampleByFilename.get(filenameKey(sample.filename))?.imageHeight,
    }));
  }
  if (!needsGroundTruth) {
    try {
      const rawItems = await getAllRawData(credentials, "all");
      if (rawItems.length) {
        const rawDataset = normalizeEdgeImpulseResponse({ samples: rawItems }, "testing");
        const rawSampleById = new Map(rawDataset.samples.map((sample) => [sample.id, sample]));
        const rawSampleByName = new Map(rawDataset.samples.map((sample) => [sample.filename, sample]));
        const rawSampleByFilename = new Map(rawDataset.samples.map((sample) => [filenameKey(sample.filename), sample]));
        normalized.samples = normalized.samples.map((sample) => ({
          ...sample,
          imageSampleId: rawSampleById.get(sample.id)?.id ?? rawSampleByName.get(sample.filename)?.id ?? rawSampleByFilename.get(filenameKey(sample.filename))?.id ?? sample.imageSampleId,
          thumbnailUrl: sample.thumbnailUrl ?? rawSampleById.get(sample.id)?.thumbnailUrl ?? rawSampleByName.get(sample.filename)?.thumbnailUrl ?? rawSampleByFilename.get(filenameKey(sample.filename))?.thumbnailUrl,
          imageWidth: sample.imageWidth ?? rawSampleById.get(sample.id)?.imageWidth ?? rawSampleByName.get(sample.filename)?.imageWidth ?? rawSampleByFilename.get(filenameKey(sample.filename))?.imageWidth,
          imageHeight: sample.imageHeight ?? rawSampleById.get(sample.id)?.imageHeight ?? rawSampleByName.get(sample.filename)?.imageHeight ?? rawSampleByFilename.get(filenameKey(sample.filename))?.imageHeight,
        }));
      }
    } catch {
      // Raw-data metadata is only used to improve image display when metrics already have labels.
    }
  }
  const samples = normalized.samples
    .filter((sample) => !sample.category || sample.category === "testing")
    .map((sample) => ({
      ...sample,
      thumbnailUrl: browserImageUrl(sample),
      classificationUrl: /^\d+$/.test(sample.id)
        ? buildShowClassificationUrl(session.projectId, Number(sample.id))
        : undefined,
    }));
  if (!samples.length) {
    throw new EdgeImpulseError("Dataset testing không có sample để đánh giá.", "EMPTY_DATASET", 404);
  }
  const dataset = {
    ...normalized,
    samples,
    warnings: [...normalized.warnings, ...unsupportedClassWarnings(normalized)],
  };
  assertRequiredClasses(dataset);
  return dataset;
}
