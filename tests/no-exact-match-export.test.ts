import {
  exportDetailsNoExactMatchCsv,
  exportOverallMetricsNoExactMatchCsv,
  exportReportNoExactMatchHtml,
  exportReportNoExactMatchJson,
} from "@/lib/export/no-exact-match";
import type { PresenceReport } from "@/lib/export/types";
import { evaluatePresence } from "@/lib/metrics/presence";
import { describe, expect, it } from "vitest";

const evaluation = evaluatePresence([
  {
    id: "1",
    filename: "a.jpg",
    category: "testing",
    groundTruthBoxes: [{ label: "human", x: 0, y: 0, width: 80, height: 80 }],
    predictions: [{ label: "human", score: 0.8, cX: 40, cY: 40 }],
  },
]);

const report: PresenceReport = {
  generatedAt: new Date(0).toISOString(),
  projectId: "123",
  dataset: "testing",
  modelVariant: "int8",
  thresholds: { human: 0.5 },
  definitions: { presence: "score >= threshold, label match, centroid inside ground-truth bbox", ignored: ["IoU"] },
  overallMetrics: evaluation.overallMetrics,
  classMetrics: evaluation.classMetrics,
  sampleResults: evaluation.sampleResults,
};

describe("No-exact-match export", () => {
  it("chỉ xuất bốn metric tổng được yêu cầu", () => {
    const csv = exportOverallMetricsNoExactMatchCsv(report);
    expect(csv).toContain("Macro F1");
    expect(csv).toContain("Micro F1");
    expect(csv).toContain("Micro Precision");
    expect(csv).toContain("Micro Recall");
    expect(csv).toContain("Tổng số ảnh");
    expect(csv).toContain("Ảnh PASS");
    expect(csv).toContain("Ảnh FAIL");
    expect(csv).not.toContain("Exact-match");
  });

  it("không đưa exact-match vào HTML, JSON và details CSV của bản mới", () => {
    expect(exportReportNoExactMatchHtml(report)).not.toContain("Exact-match");
    expect(exportReportNoExactMatchJson(report)).not.toContain("exactMatch");
    expect(exportDetailsNoExactMatchCsv(report.sampleResults)).not.toContain("exact_match");
  });

  it("giữ thống kê số ảnh trong JSON bản mới", () => {
    const json = JSON.parse(exportReportNoExactMatchJson(report));
    expect(json.overallMetrics.totalSamples).toBe(1);
    expect(json.overallMetrics.passSamples).toBe(1);
    expect(json.overallMetrics.failedSamples).toBe(0);
  });
});
