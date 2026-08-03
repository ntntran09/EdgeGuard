import type { ClassPresenceMetric, SamplePresenceResult } from "@/lib/metrics/presence";

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const rowsToCsv = (rows: unknown[][]) => `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`;

export function exportSummaryCsv(metrics: ClassPresenceMetric[]): string {
  return rowsToCsv([
    ["class", "threshold", "precision", "recall", "f1", "tp", "fp", "fn", "tn", "support", "predicted_positives"],
    ...metrics.map((m) => [
      m.className,
      m.threshold,
      m.precision,
      m.recall,
      m.f1,
      m.tp,
      m.fp,
      m.fn,
      m.tn,
      m.support,
      m.predictedPositives,
    ]),
  ]);
}

export function exportDetailsCsv(results: SamplePresenceResult[]): string {
  return rowsToCsv([
    [
      "sample_id",
      "filename",
      "ground_truth_labels",
      "predicted_labels",
      "maximum_scores",
      "tp_labels",
      "fp_labels",
      "fn_labels",
      "result",
      "exact_match",
    ],
    ...results.map((r) => [
      r.sampleId,
      r.filename,
      r.groundTruthLabels.join("|"),
      r.predictedLabels.join("|"),
      r.maxScores,
      r.truePositiveLabels.join("|"),
      r.falsePositiveLabels.join("|"),
      r.falseNegativeLabels.join("|"),
      r.result,
      r.exactMatch,
    ]),
  ]);
}
