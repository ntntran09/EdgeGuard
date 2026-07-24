import { getBoxCentroid, transformBoxContain } from "@/lib/visualization/coordinates";
import { describe, expect, it } from "vitest";

describe("Qualitative visualization coordinates", () => {
  it("tính centroid từ bounding box", () => {
    expect(getBoxCentroid({ label: "human", x: 32, y: 32, width: 16, height: 24 })).toEqual({
      x: 40,
      y: 44,
    });
  });

  it("trả null nếu box thiếu tọa độ", () => {
    expect(getBoxCentroid({ label: "human" })).toBeNull();
  });

  it("remap contain từ ảnh ngang sang input vuông có letterbox", () => {
    const transformed = transformBoxContain(
      { label: "human", x: 160, y: 80, width: 160, height: 160 },
      { width: 640, height: 426 },
      { width: 96, height: 96 },
    );
    expect(transformed.x).toBeCloseTo(24);
    expect(transformed.y).toBeCloseTo(28.05);
    expect(transformed.width).toBeCloseTo(24);
    expect(transformed.height).toBeCloseTo(24);
  });
});
