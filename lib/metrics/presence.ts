import type { NormalizedSample } from "@/lib/edge-impulse/types";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  isHumanLabel,
  isObjectLabel,
  isSupportedLabel,
  SUPPORTED_LABEL_LIST,
} from "@/lib/constants/fomo";
import type { Box } from "@/lib/edge-impulse/types";
import { getBoxCentroid, hasDrawableCoordinates } from "@/lib/visualization/coordinates";

export type ThresholdMap = Record<string, number>;
export type SampleResultKind =
  | "PASS"
  | "FALSE_POSITIVE"
  | "FALSE_NEGATIVE"
  | "MIXED_ERROR"
  | "SKIPPED_UNSUPPORTED_LABEL";

export type SamplePresenceResult = {
  sampleId: string;
  filename: string;
  groundTruthLabels: string[];
  predictedLabels: string[];
  maxScores: Record<string, number>;
  truePositiveLabels: string[];
  falsePositiveLabels: string[];
  falseNegativeLabels: string[];
  exactMatch: boolean;
  result: SampleResultKind;
  warnings: string[];
  skipped: boolean;
};

export type ClassPresenceMetric = {
  className: string;
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  support: number;
  predictedPositives: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
};

export type OverallPresenceMetrics = {
  microPrecision: number | null;
  microRecall: number | null;
  microF1: number | null;
  macroPrecision: number | null;
  macroRecall: number | null;
  macroF1: number | null;
  exactMatchAccuracy: number | null;
  totalSamples: number;
  exactMatches: number;
  failedSamples: number;
};

export type PresenceEvaluation = {
  classes: string[];
  classMetrics: ClassPresenceMetric[];
  overallMetrics: OverallPresenceMetrics;
  sampleResults: SamplePresenceResult[];
};

export type Scenario = "HUMAN_AND_OBJECT" | "HUMAN_ONLY" | "OBJECT_ONLY" | "BACKGROUND";

export const DEFAULT_THRESHOLD = DEFAULT_CONFIDENCE_THRESHOLD;
export const DEFAULT_EXCLUDED_LABELS = ["background", "_background", "unknown"];

const sorted = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b));
const supportedClasses = () => [...SUPPORTED_LABEL_LIST];

export function classifyScenario(groundTruth: Box[]): Scenario {
  const supportedGroundTruth = groundTruth.filter((box) => isSupportedLabel(box.label));
  const hasHuman = supportedGroundTruth.some((box) => isHumanLabel(box.label));
  const hasObject = supportedGroundTruth.some((box) => isObjectLabel(box.label));
  if (hasHuman && hasObject) return "HUMAN_AND_OBJECT";
  if (hasHuman) return "HUMAN_ONLY";
  if (hasObject) return "OBJECT_ONLY";
  return "BACKGROUND";
}

export function safeDivide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function harmonicMean(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null || precision + recall === 0) return null;
  return (2 * precision * recall) / (precision + recall);
}

export function meanIgnoringNull(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

export function discoverClasses(
  samples: NormalizedSample[],
  metadataClasses: string[] = [],
  excludedLabels: string[] = DEFAULT_EXCLUDED_LABELS,
): string[] {
  void samples;
  void metadataClasses;
  void excludedLabels;
  return supportedClasses();
}

function hasCentroidInsideBox(prediction: Box, groundTruthBox: Box): boolean {
  if (!hasDrawableCoordinates(groundTruthBox)) return false;
  const centroid = getBoxCentroid(prediction);
  if (!centroid) return false;
  return (
    centroid.x >= groundTruthBox.x &&
    centroid.x <= groundTruthBox.x + groundTruthBox.width &&
    centroid.y >= groundTruthBox.y &&
    centroid.y <= groundTruthBox.y + groundTruthBox.height
  );
}

function hasMatchedPrediction(label: string, groundTruthBoxes: Box[], predictions: Box[]): boolean {
  return groundTruthBoxes
    .filter((box) => box.label === label)
    .some((box) =>
      predictions.some(
        (prediction) =>
          prediction.label === label && hasCentroidInsideBox(prediction, box),
      ),
    );
}

export function evaluateSample(
  sample: NormalizedSample,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
): SamplePresenceResult {
  const classes = supportedClasses();
  const unsupportedGroundTruth = sample.groundTruthBoxes
    .map((box) => box.label)
    .filter((label) => !isSupportedLabel(label));
  const unsupportedPredictions = sample.predictions
    .map((prediction) => prediction.label)
    .filter((label) => !isSupportedLabel(label));
  const warnings: string[] = [];
  if (unsupportedGroundTruth.length || unsupportedPredictions.length) {
    warnings.push("UNSUPPORTED_LABEL");
    warnings.push(
      "Dữ liệu chứa class không được hỗ trợ. Custom metric này chỉ hỗ trợ human, package và backpack.",
    );
  }
  if (unsupportedPredictions.length) warnings.push("UNSUPPORTED_PREDICTION_IGNORED");
  if (unsupportedGroundTruth.length) {
    return {
      sampleId: sample.id,
      filename: sample.filename,
      groundTruthLabels: sorted(new Set(sample.groundTruthBoxes.map((box) => box.label))),
      predictedLabels: [],
      maxScores: Object.fromEntries(classes.map((label) => [label, 0])),
      truePositiveLabels: [],
      falsePositiveLabels: [],
      falseNegativeLabels: [],
      exactMatch: false,
      result: "SKIPPED_UNSUPPORTED_LABEL",
      warnings,
      skipped: true,
    };
  }
  const groundTruth = new Set(
    sample.groundTruthBoxes.map((box) => box.label).filter(isSupportedLabel),
  );
  const maxScores: Record<string, number> = Object.fromEntries(classes.map((label) => [label, 0]));
  for (const prediction of sample.predictions) {
    if (isSupportedLabel(prediction.label)) {
      maxScores[prediction.label] = Math.max(maxScores[prediction.label] ?? 0, prediction.score);
    }
  }
  const thresholdedPredictions = sample.predictions.filter(
    (prediction) => isSupportedLabel(prediction.label) && prediction.score >= confidenceThreshold,
  );
  const predicted = new Set<string>(thresholdedPredictions.map((prediction) => prediction.label));
  const scenario = classifyScenario(sample.groundTruthBoxes);
  const matchedLabels = new Set(
    [...groundTruth].filter((label) =>
      hasMatchedPrediction(label, sample.groundTruthBoxes, thresholdedPredictions),
    ),
  );
  const hasHumanPrediction = thresholdedPredictions.some((prediction) => isHumanLabel(prediction.label));
  const matchedHuman = matchedLabels.has("human");
  const matchedObjectLabels = [...matchedLabels].filter(isObjectLabel);

  let truePositiveLabels: string[] = [];
  let falsePositiveLabels: string[] = [];
  let falseNegativeLabels: string[] = [];
  let exactMatch = false;

  if (scenario === "BACKGROUND") {
    falsePositiveLabels = sorted(predicted);
    exactMatch = falsePositiveLabels.length === 0;
  } else if (scenario === "HUMAN_ONLY") {
    truePositiveLabels = matchedHuman ? ["human"] : [];
    falseNegativeLabels = matchedHuman ? [] : ["human"];
    exactMatch = matchedHuman;
  } else if (scenario === "OBJECT_ONLY") {
    truePositiveLabels = sorted(matchedObjectLabels);
    falsePositiveLabels = hasHumanPrediction ? ["human"] : [];
    falseNegativeLabels = matchedObjectLabels.length ? [] : sorted([...groundTruth].filter(isObjectLabel));
    exactMatch = matchedObjectLabels.length > 0 && !hasHumanPrediction;
  } else {
    truePositiveLabels = matchedHuman ? ["human"] : [];
    falseNegativeLabels = matchedHuman ? [] : ["human"];
    exactMatch = matchedHuman;
  }

  const result: SampleResultKind = exactMatch
    ? "PASS"
    : falsePositiveLabels.length && falseNegativeLabels.length
      ? "MIXED_ERROR"
      : falsePositiveLabels.length
        ? "FALSE_POSITIVE"
        : "FALSE_NEGATIVE";
  return {
    sampleId: sample.id,
    filename: sample.filename,
    groundTruthLabels: sorted(groundTruth),
    predictedLabels: sorted(predicted),
    maxScores,
    truePositiveLabels,
    falsePositiveLabels,
    falseNegativeLabels,
    exactMatch,
    result,
    warnings,
    skipped: false,
  };
}

export function evaluatePresence(
  samples: NormalizedSample[],
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  options: { metadataClasses?: string[]; excludedLabels?: string[] } = {},
): PresenceEvaluation {
  void options;
  const classes = supportedClasses();
  const sampleResults = samples.map((sample) => evaluateSample(sample, confidenceThreshold));
  const countedResults = sampleResults.filter((result) => !result.skipped);
  const classMetrics = classes.map((className): ClassPresenceMetric => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (const result of countedResults) {
      if (result.truePositiveLabels.includes(className)) tp += 1;
      else if (result.falsePositiveLabels.includes(className)) fp += 1;
      else if (result.falseNegativeLabels.includes(className)) fn += 1;
      else tn += 1;
    }
    const precision = safeDivide(tp, tp + fp);
    const recall = safeDivide(tp, tp + fn);
    return {
      className,
      threshold: confidenceThreshold,
      tp,
      fp,
      fn,
      tn,
      support: tp + fn,
      predictedPositives: tp + fp,
      precision,
      recall,
      f1: harmonicMean(precision, recall),
    };
  });
  const tp = classMetrics.reduce((sum, metric) => sum + metric.tp, 0);
  const fp = classMetrics.reduce((sum, metric) => sum + metric.fp, 0);
  const fn = classMetrics.reduce((sum, metric) => sum + metric.fn, 0);
  const microPrecision = safeDivide(tp, tp + fp);
  const microRecall = safeDivide(tp, tp + fn);
  const exactMatches = countedResults.filter((result) => result.exactMatch).length;
  return {
    classes,
    classMetrics,
    sampleResults,
    overallMetrics: {
      microPrecision,
      microRecall,
      microF1: harmonicMean(microPrecision, microRecall),
      macroPrecision: meanIgnoringNull(classMetrics.map((metric) => metric.precision)),
      macroRecall: meanIgnoringNull(classMetrics.map((metric) => metric.recall)),
      macroF1: meanIgnoringNull(classMetrics.map((metric) => metric.f1)),
      exactMatchAccuracy: safeDivide(exactMatches, countedResults.length),
      totalSamples: countedResults.length,
      exactMatches,
      failedSamples: countedResults.length - exactMatches,
    },
  };
}
