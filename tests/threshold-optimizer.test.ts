import type { NormalizedSample } from "@/lib/edge-impulse/types";
import { optimizeThresholdForClass } from "@/lib/metrics/threshold-optimizer";
import { describe, expect, it } from "vitest";

const make = (id: string, gt: boolean, score: number): NormalizedSample => ({
  id,
  filename: `${id}.jpg`,
  category: "validation",
  groundTruthBoxes: gt ? [{ label: "human", x: 0, y: 0, width: 80, height: 80 }] : [],
  predictions: score ? [{ label: "human", score, cX: 40, cY: 40 }] : [],
});

describe("Threshold optimizer", () => {
  it("sweep 0.05–0.95 với 91 điểm", () => {
    const result = optimizeThresholdForClass([make("1", true, .8), make("2", false, .3)], "human");
    expect(result.curve).toHaveLength(91);
    expect(result.threshold).toBe(.8);
    expect(result.f1).toBe(1);
  });

  it("tie-break ưu tiên threshold cao hơn sau F1, recall, precision", () => {
    const result = optimizeThresholdForClass([make("1", true, .9)], "human");
    expect(result.threshold).toBe(.9);
  });
});
