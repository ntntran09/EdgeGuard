import { exportDetailsCsv, exportSummaryCsv } from "@/lib/export/csv";
import { exportReportHtml } from "@/lib/export/html";
import { exportReportJson } from "@/lib/export/json";
import type { PresenceReport } from "@/lib/export/types";
import { evaluatePresence } from "@/lib/metrics/presence";
import { describe, expect, it } from "vitest";

const evaluation = evaluatePresence([
  {
    id: "1",
    filename: "a,1.jpg",
    category: "testing",
    groundTruthBoxes: [{ label: "human", x: 0, y: 0, width: 80, height: 80 }],
    predictions: [{ label: "human", score: .8, cX: 40, cY: 40 }],
  },
]);
const report: PresenceReport & { apiKey?: string } = {
  generatedAt: new Date(0).toISOString(),
  projectId: "123",
  dataset: "testing",
  modelVariant: "int8",
  thresholds: { human: .5 },
  definitions: { presence: "score >= threshold, label match, centroid inside ground-truth bbox", ignored: ["IoU"] },
  ...evaluation,
  apiKey: "ei_super_secret_abcdefghijklmnopqrstuvwxyz",
};

describe("Export", () => {
  it("tạo hai CSV đúng header và escape filename", () => {
    expect(exportSummaryCsv(evaluation.classMetrics)).toContain("predicted_positives");
    expect(exportDetailsCsv(evaluation.sampleResults)).toContain('"a,1.jpg"');
  });
  it("report JSON và HTML không chứa API key", () => {
    expect(exportReportJson(report)).not.toContain("ei_super_secret");
    expect(exportReportHtml(report)).not.toContain("ei_super_secret");
  });
  it("HTML self-contained có filter, print CSS và ghi chú centroid", () => {
    const html = exportReportHtml(report);
    expect(html).toContain("@media print");
    expect(html).toContain('id="search"');
    expect(html).toContain("centroid");
    expect(html).not.toMatch(/<link|src="https?:/);
  });
});
