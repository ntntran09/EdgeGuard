import { FOMO_LABELS, isHumanLabel, isObjectLabel, isSupportedLabel } from "@/lib/constants/fomo";
import type { NormalizedSample } from "@/lib/edge-impulse/types";
import {
  classifyScenario,
  discoverClasses,
  evaluatePresence,
  evaluateSample,
  harmonicMean,
  meanIgnoringNull,
  safeDivide,
} from "@/lib/metrics/presence";
import { describe, expect, it } from "vitest";

const sample = (groundTruth: string[], predictions: Array<[string, number]>, coordinates = 0): NormalizedSample => ({
  id: "s1",
  filename: "sample.jpg",
  category: "testing",
  groundTruthBoxes: groundTruth.map((label, i) => ({
    label,
    x: coordinates + i * 100,
    y: 0,
    width: 80,
    height: 80,
  })),
  predictions: predictions.map(([label, score]) => {
    const matchingIndex = groundTruth.findIndex((groundTruthLabel) => groundTruthLabel === label);
    const boxIndex = matchingIndex >= 0 ? matchingIndex : 0;
    return { label, score, cX: coordinates + boxIndex * 100 + 40, cY: 40 };
  }),
});

describe("Presence metric", () => {
  it("uses only the fixed FOMO labels", () => {
    expect(discoverClasses([])).toEqual(["human", "package", "backpack"]);
    expect(isHumanLabel("human")).toBe(true);
    expect(isHumanLabel("person")).toBe(false);
    expect(isObjectLabel("package")).toBe(true);
    expect(isObjectLabel("backpack")).toBe(true);
    expect(isObjectLabel("parcel")).toBe(false);
    expect(isObjectLabel("bag")).toBe(false);
    expect(isSupportedLabel("human")).toBe(true);
    expect(isSupportedLabel("other")).toBe(false);
  });

  it("tính đúng label khi centroid nằm trong bbox ground truth", () => {
    const result = evaluatePresence([sample(["backpack"], [["backpack", 0.82]], 200)]);
    expect(result.classMetrics.find((item) => item.className === "backpack")).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });

  it("centroid ngoài bbox thì không nhận", () => {
    const result = evaluateSample({
      ...sample(["backpack"], []),
      predictions: [{ label: "backpack", score: 0.82, cX: 999, cY: 999 }],
    });
    expect(result.result).toBe("FALSE_NEGATIVE");
    expect(result.falseNegativeLabels).toEqual(["backpack"]);
  });

  it("duplicate prediction chỉ tính một lần và dùng confidence lớn nhất", () => {
    const result = evaluatePresence([sample(["backpack"], [["backpack", 0.2], ["backpack", 0.91], ["backpack", 0.6]])]);
    expect(result.sampleResults[0].maxScores.backpack).toBe(0.91);
    expect(result.classMetrics.find((item) => item.className === "backpack")?.tp).toBe(1);
  });

  it("duplicate Ground Truth cùng lớp chỉ tính một lần", () => {
    const result = evaluatePresence([sample(["human", "human", "human"], [["human", 0.8]])]);
    expect(result.classMetrics.find((item) => item.className === "human")?.support).toBe(1);
  });

  it("score bằng threshold là positive; thấp hơn là negative", () => {
    expect(evaluatePresence([sample(["package"], [["package", 0.5]])], 0.5).classMetrics.find((item) => item.className === "package")?.tp).toBe(1);
    expect(evaluatePresence([sample(["package"], [["package", 0.4999]])], 0.5).classMetrics.find((item) => item.className === "package")?.fn).toBe(1);
  });

  it("background rỗng là PASS và background báo nhầm là FP", () => {
    expect(evaluateSample(sample([], [])).result).toBe("PASS");
    expect(evaluateSample(sample([], [["human", 0.7]])).result).toBe("FALSE_POSITIVE");
  });

  it("thiếu prediction là FN", () => {
    expect(evaluateSample(sample(["human"], [])).result).toBe("FALSE_NEGATIVE");
  });

  it("vừa human vừa object thì human đúng trong bbox là PASS và kệ vật", () => {
    expect(evaluatePresence([sample(["human", "package"], [["human", .8], ["package", .7]])]).sampleResults[0].exactMatch).toBe(true);
    expect(evaluatePresence([sample(["human", "package"], [["human", .8]])]).sampleResults[0].exactMatch).toBe(true);
    const partial = evaluatePresence([sample(["human", "package"], [["package", .8]])]).sampleResults[0];
    expect(partial.result).toBe("FALSE_NEGATIVE");
    expect(partial.falseNegativeLabels).toEqual(["human"]);
  });

  it("human-only đúng human trong bbox thì dư prediction khác vẫn PASS", () => {
    expect(evaluateSample(sample(["human"], [["human", .9], ["package", .9]])).result).toBe("PASS");
  });

  it("object-only cần đúng object trong bbox và dư human là sai", () => {
    expect(evaluateSample(sample(["package"], [["package", .9]])).result).toBe("PASS");
    expect(evaluateSample(sample(["package"], [["package", .9], ["human", .9]])).result).toBe("FALSE_POSITIVE");
    expect(evaluateSample(sample(["package"], [["backpack", .9]])).result).toBe("FALSE_NEGATIVE");
  });

  it("mẫu số 0 trả null và macro bỏ qua null", () => {
    expect(safeDivide(0, 0)).toBeNull();
    expect(harmonicMean(0, 0)).toBeNull();
    expect(meanIgnoringNull([null, .5, 1])).toBe(.75);
  });

  it("confidence threshold global có thể thay đổi", () => {
    const result = evaluatePresence([sample(["human", "package"], [["human", .6], ["package", .6]])], .7);
    expect(result.sampleResults[0].predictedLabels).toEqual([]);
  });

  it("unsupported ground-truth label bị skip khỏi tổng", () => {
    const result = evaluatePresence([sample(["person"], [["human", .9]])]);
    expect(result.overallMetrics.totalSamples).toBe(0);
    expect(result.sampleResults[0]).toMatchObject({ result: "SKIPPED_UNSUPPORTED_LABEL", skipped: true });
    expect(result.sampleResults[0].warnings).toContain("UNSUPPORTED_LABEL");
  });

  it("unsupported prediction bị bỏ qua nhưng có warning", () => {
    const result = evaluateSample(sample([], [["parcel", .95]]));
    expect(result.result).toBe("PASS");
    expect(result.predictedLabels).toEqual([]);
    expect(result.warnings).toContain("UNSUPPORTED_PREDICTION_IGNORED");
  });

  it("classifyScenario chỉ dùng class cố định", () => {
    expect(classifyScenario([{ label: FOMO_LABELS.human }, { label: FOMO_LABELS.package }])).toBe("HUMAN_AND_OBJECT");
    expect(classifyScenario([{ label: FOMO_LABELS.human }])).toBe("HUMAN_ONLY");
    expect(classifyScenario([{ label: FOMO_LABELS.backpack }])).toBe("OBJECT_ONLY");
    expect(classifyScenario([{ label: "person" }])).toBe("BACKGROUND");
  });

  it("tọa độ chỉ cần centroid nằm trong bbox, không cần khớp tâm bbox", () => {
    const result = evaluatePresence([
      {
        ...sample(["human"], []),
        predictions: [{ label: "human", score: .8, cX: 10, cY: 10 }],
      },
    ]);
    expect(result.sampleResults[0].result).toBe("PASS");
  });
});
