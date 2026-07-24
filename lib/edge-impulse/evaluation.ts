import { SUPPORTED_LABEL_LIST } from "@/lib/constants/fomo";
import {
  buildShowClassificationUrl,
  EdgeImpulseError,
  getAllRawData,
  getModelTestingResults,
} from "@/lib/edge-impulse/client";
import { normalizeEdgeImpulseResponse } from "@/lib/edge-impulse/normalize";
import type { NormalizedDataset } from "@/lib/edge-impulse/types";
import { setEdgeImpulseImageSources, type ServerSession } from "@/lib/edge-impulse/session";

const SUPPORTED_LABEL_VALUES: readonly string[] = SUPPORTED_LABEL_LIST;
const RAW_DATA_CATEGORIES = ["testing", "validation", "training"] as const;

function filenameKey(filename: string): string {
  const basename = filename.trim().toLowerCase().replace(/\\/g, "/").split("/").pop() ?? filename.trim().toLowerCase();
  return basename
    .replace(/\.(json|cbor)$/i, "")
    .replace(/\.(jpe?g|png|webp|gif|bmp)$/i, "");
}

function matchingRawSample(
  rawSamples: NormalizedDataset["samples"],
  sample: NormalizedDataset["samples"][number],
): NormalizedDataset["samples"][number] | undefined {
  const sampleKey = filenameKey(sample.filename);
  return rawSamples.find((raw) => {
    const rawKey = filenameKey(raw.filename);
    return raw.id === sample.id ||
      raw.filename === sample.filename ||
      rawKey === sampleKey ||
      rawKey.includes(sampleKey) ||
      sampleKey.includes(rawKey);
  });
}

function browserImageUrl(sample: NormalizedDataset["samples"][number]): string {
  if (sample.thumbnailUrl?.startsWith("/demo/")) {
    return sample.thumbnailUrl;
  }
  return `/api/images/${encodeURIComponent(sample.imageSampleId ?? sample.id)}`;
}

async function loadRawDataMetadata(credentials: { projectId: number; apiKey: string }): Promise<NormalizedDataset | undefined> {
  const rawItems: unknown[] = [];
  for (const category of RAW_DATA_CATEGORIES) {
    try {
      rawItems.push(...await getAllRawData(credentials, category));
    } catch {
      // Some projects do not expose every category; keep probing the rest.
    }
  }
  return rawItems.length ? normalizeEdgeImpulseResponse({ samples: rawItems }, "testing") : undefined;
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

export async function loadEvaluationDataset(session: ServerSession, sessionId?: string): Promise<NormalizedDataset> {
  const credentials = { projectId: session.projectId, apiKey: session.apiKey };
  const payload = await getModelTestingResults(credentials);
  const normalized = normalizeEdgeImpulseResponse(payload, "testing");
  const needsGroundTruth = normalized.samples.every((sample) => sample.groundTruthBoxes.length === 0);
  if (needsGroundTruth) {
    const rawDataset = await loadRawDataMetadata(credentials);
    if (!rawDataset) {
      throw new EdgeImpulseError(
        "Không thể tải dữ liệu Model Testing từ Edge Impulse.",
        "MODEL_TESTING_LOAD_FAILED",
        502,
      );
    }
    const groundTruthById = new Map(rawDataset.samples.map((sample) => [sample.id, sample.groundTruthBoxes]));
    const groundTruthByName = new Map(rawDataset.samples.map((sample) => [sample.filename, sample.groundTruthBoxes]));
    const rawSampleById = new Map(rawDataset.samples.map((sample) => [sample.id, sample]));
    const rawSampleByName = new Map(rawDataset.samples.map((sample) => [sample.filename, sample]));
    const rawSampleByFilename = new Map(rawDataset.samples.map((sample) => [filenameKey(sample.filename), sample]));
    normalized.samples = normalized.samples.map((sample) => {
      const rawSample =
        rawSampleById.get(sample.id) ??
        rawSampleByName.get(sample.filename) ??
        rawSampleByFilename.get(filenameKey(sample.filename)) ??
        matchingRawSample(rawDataset.samples, sample);
      return {
        ...sample,
        groundTruthBoxes: sample.groundTruthBoxes.length
          ? sample.groundTruthBoxes
          : groundTruthById.get(sample.id) ?? groundTruthByName.get(sample.filename) ?? rawSample?.groundTruthBoxes ?? [],
        imageSampleId: rawSample?.id ?? sample.imageSampleId,
        thumbnailUrl: sample.thumbnailUrl ?? rawSample?.thumbnailUrl,
        imageWidth: sample.imageWidth ?? rawSample?.imageWidth,
        imageHeight: sample.imageHeight ?? rawSample?.imageHeight,
      };
    });
  }
  if (!needsGroundTruth) {
    try {
      const rawDataset = await loadRawDataMetadata(credentials);
      if (rawDataset) {
        const rawSampleById = new Map(rawDataset.samples.map((sample) => [sample.id, sample]));
        const rawSampleByName = new Map(rawDataset.samples.map((sample) => [sample.filename, sample]));
        const rawSampleByFilename = new Map(rawDataset.samples.map((sample) => [filenameKey(sample.filename), sample]));
        normalized.samples = normalized.samples.map((sample) => {
          const rawSample =
            rawSampleById.get(sample.id) ??
            rawSampleByName.get(sample.filename) ??
            rawSampleByFilename.get(filenameKey(sample.filename)) ??
            matchingRawSample(rawDataset.samples, sample);
          return {
            ...sample,
            imageSampleId: rawSample?.id ?? sample.imageSampleId,
            thumbnailUrl: sample.thumbnailUrl ?? rawSample?.thumbnailUrl,
            imageWidth: sample.imageWidth ?? rawSample?.imageWidth,
            imageHeight: sample.imageHeight ?? rawSample?.imageHeight,
          };
        });
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
  setEdgeImpulseImageSources(
    sessionId,
    normalized.samples.map((sample) => ({
      keys: [sample.id, sample.imageSampleId ?? ""],
      url: sample.thumbnailUrl,
    })),
  );
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
