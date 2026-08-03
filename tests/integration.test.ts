import demo from "@/fixtures/edge-impulse-demo.json";
import { normalizeEdgeImpulseResponse } from "@/lib/edge-impulse/normalize";
import { exportReportJson } from "@/lib/export/json";
import type { PresenceReport } from "@/lib/export/types";
import { evaluatePresence } from "@/lib/metrics/presence";
import { describe, expect, it } from "vitest";

describe("Integration: raw → normalize → metrics → report", () => {
  it("cho kết quả Presence mong đợi trên fixture", () => {
    const normalized = normalizeEdgeImpulseResponse(demo);
    const evaluation = evaluatePresence(normalized.samples);
    const centroidCase = evaluation.sampleResults.find((item) => item.sampleId === "demo-01")!;
    const outsideCentroidCase = evaluation.sampleResults.find((item) => item.sampleId === "demo-02")!;
    const thresholdCase = evaluation.sampleResults.find((item) => item.sampleId === "demo-09")!;
    expect(centroidCase.result).toBe("PASS");
    expect(centroidCase.truePositiveLabels).toEqual(["human"]);
    expect(outsideCentroidCase.result).toBe("FALSE_NEGATIVE");
    expect(thresholdCase.result).toBe("PASS");
    const report: PresenceReport = { generatedAt: new Date().toISOString(), projectId: "DEMO", dataset: "demo", modelVariant: "int8", thresholds: { human: .5, backpack: .5, package: .5 }, definitions: { presence: "score >= threshold, label match, centroid inside ground-truth bbox", ignored: ["IoU"] }, overallMetrics: evaluation.overallMetrics, classMetrics: evaluation.classMetrics, sampleResults: evaluation.sampleResults };
    const output = JSON.parse(exportReportJson(report)) as PresenceReport;
    expect(output.sampleResults).toHaveLength(10);
    expect(output.classMetrics.map((item) => item.className)).toEqual(["human", "package", "backpack"]);
  });

  it("chấm đúng khi Edge Impulse trả prediction bbox dạng normalized 0..1", () => {
    const normalized = normalizeEdgeImpulseResponse({
      success: true,
      result: [
        {
          sampleId: 3031647643,
          sample: {
            id: 3031647643,
            filename: "normalized.jpg",
            imageDimensions: { width: 512, height: 512 },
            boundingBoxes: [{ label: "backpack", x: 88.75, y: 101, width: 296.5, height: 376 }],
          },
          boundingBoxes: [{ label: "backpack", x: 0.4, y: 0.4, width: 0.2, height: 0.2, score: 0.94 }],
        },
      ],
    });
    expect(evaluatePresence(normalized.samples).sampleResults[0].result).toBe("PASS");
  });
});
