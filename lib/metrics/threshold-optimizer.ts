import type { NormalizedSample } from "@/lib/edge-impulse/types";
import { evaluatePresence, harmonicMean, meanIgnoringNull } from "./presence";

export type ThresholdPoint = {
  threshold: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
};

export type ThresholdOptimization = {
  className: string;
  threshold: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  curve: ThresholdPoint[];
};

function score(value: number | null): number {
  return value ?? -1;
}

function isBetter(candidate: ThresholdPoint, current: ThresholdPoint): boolean {
  if (score(candidate.f1) !== score(current.f1)) return score(candidate.f1) > score(current.f1);
  if (score(candidate.recall) !== score(current.recall)) return score(candidate.recall) > score(current.recall);
  if (score(candidate.precision) !== score(current.precision)) return score(candidate.precision) > score(current.precision);
  return candidate.threshold > current.threshold;
}

export function optimizeThresholdForClass(
  samples: NormalizedSample[],
  className: string,
): ThresholdOptimization {
  const points: ThresholdPoint[] = [];
  for (let step = 5; step <= 95; step += 1) {
    const threshold = step / 100;
    const metric = evaluatePresence(samples, threshold).classMetrics.find((item) => item.className === className)!;
    points.push({ threshold, precision: metric.precision, recall: metric.recall, f1: metric.f1 });
  }
  let best = points[0];
  for (const point of points.slice(1)) if (isBetter(point, best)) best = point;
  return {
    className,
    threshold: best.threshold,
    precision: best.precision,
    recall: best.recall,
    f1: best.f1,
    curve: points,
  };
}

export function optimizeGlobalThreshold(samples: NormalizedSample[]): ThresholdOptimization {
  const points: ThresholdPoint[] = [];
  for (let step = 5; step <= 95; step += 1) {
    const threshold = step / 100;
    const evaluation = evaluatePresence(samples, threshold);
    const precision = meanIgnoringNull(evaluation.classMetrics.map((metric) => metric.precision));
    const recall = meanIgnoringNull(evaluation.classMetrics.map((metric) => metric.recall));
    points.push({ threshold, precision, recall, f1: harmonicMean(precision, recall) });
  }
  let best = points[0];
  for (const point of points.slice(1)) if (isBetter(point, best)) best = point;
  return { className: "global", ...best, curve: points };
}

export function optimizeAllThresholds(samples: NormalizedSample[], classes: string[]) {
  return Object.fromEntries(classes.map((className) => [className, optimizeThresholdForClass(samples, className)]));
}
