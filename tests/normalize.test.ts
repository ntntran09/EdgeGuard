import demo from "@/fixtures/edge-impulse-demo.json";
import { normalizeEdgeImpulseResponse } from "@/lib/edge-impulse/normalize";
import { describe, expect, it } from "vitest";

describe("Edge Impulse normalizer", () => {
  it("chuẩn hóa fixture permissive và giữ tọa độ debug", () => {
    const result = normalizeEdgeImpulseResponse(demo);
    expect(result.samples).toHaveLength(10);
    expect(result.availableVariants).toEqual(["int8", "float32"]);
    expect(result.samples[1].predictions[0]).toMatchObject({ label: "backpack", score: .82, x: 210 });
  });

  it("đọc các alias field thường gặp", () => {
    const result = normalizeEdgeImpulseResponse({ results: [{ id: 1, name: "a.jpg", boxes: [{ class: "human" }], result: { boundingBoxes: [{ className: "human", confidence: .7 }] } }] });
    expect(result.samples[0]).toMatchObject({ id: "1", filename: "a.jpg" });
    expect(result.samples[0].predictions[0].score).toBe(.7);
  });

  it("đọc payload Model Testing chính thức với result[] và sample ID dạng số", () => {
    const result = normalizeEdgeImpulseResponse({
      success: true,
      availableVariants: ["int8"],
      result: [
        {
          sampleId: 9182,
          sample: {
            id: 9182,
            filename: "camera.jpg",
            category: "testing",
            boundingBoxes: [{ label: "human", x: 10, y: 12, width: 30, height: 50 }],
            imageDimensions: { width: 320, height: 320 },
            videoUrl: "https://example.test/sample.jpg",
          },
          boundingBoxes: [
            { label: "human", score: 0.83, x: 15, y: 18, width: 28, height: 46 },
          ],
        },
      ],
    });
    expect(result.samples[0]).toMatchObject({
      id: "9182",
      imageSampleId: "9182",
      filename: "camera.jpg",
      imageWidth: 320,
      imageHeight: 320,
      thumbnailUrl: "https://example.test/sample.jpg",
    });
    expect(result.samples[0].groundTruthBoxes).toHaveLength(1);
    expect(result.samples[0].predictions[0]).toMatchObject({ label: "human", score: 0.83 });
  });

  it("Ä‘á»c URL thumbnail/video tá»« raw-data metadata", () => {
    const result = normalizeEdgeImpulseResponse({
      success: true,
      samples: [
        {
          id: 77,
          filename: "raw-image.jpg",
          category: "testing",
          thumbnailVideoFull: "https://example.test/raw-image.jpg",
          boundingBoxes: [{ label: "human" }],
        },
      ],
    });
    expect(result.samples[0]).toMatchObject({
      id: "77",
      imageSampleId: "77",
      thumbnailUrl: "https://example.test/raw-image.jpg",
    });
  });

  it("suy ra classes từ sample khi payload Model Testing không có labels top-level", () => {
    const result = normalizeEdgeImpulseResponse({
      success: true,
      availableVariants: ["int8"],
      result: [
        {
          sampleId: 1,
          sample: {
            id: 1,
            filename: "human.jpg",
            boundingBoxes: [{ label: "human" }],
          },
          boundingBoxes: [{ label: "human", score: 0.91 }],
        },
        {
          sampleId: 2,
          sample: {
            id: 2,
            filename: "objects.jpg",
            boundingBoxes: [{ label: "package" }, { label: "backpack" }],
          },
          boundingBoxes: [
            { label: "package", score: 0.83 },
            { label: "backpack", score: 0.72 },
          ],
        },
      ],
    });
    expect(result.classes.sort()).toEqual(["backpack", "human", "package"]);
  });

  it("scale prediction normalized 0..1 theo imageDimensions", () => {
    const result = normalizeEdgeImpulseResponse({
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
    expect(result.samples[0].predictions[0]).toMatchObject({
      x: 204.8,
      y: 204.8,
      width: 102.4,
      height: 102.4,
    });
  });

  it("đọc FOMO bounding boxes lồng trong classifications → result", () => {
    const result = normalizeEdgeImpulseResponse({
      success: true,
      accuracy: { accuracyScore: 0.3613 },
      result: [
        {
          sampleId: 91,
          sample: {
            id: 91,
            filename: "nested.jpg",
            category: "testing",
            boundingBoxes: [{ label: "backpack", x: 1, y: 2, width: 10, height: 12 }],
          },
          classifications: [
            {
              result: [
                {
                  boundingBoxes: [
                    { label: "backpack", value: 0.82, x: 100, y: 90, width: 8, height: 9 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.samples[0].predictions).toEqual([
      { label: "backpack", score: 0.82, x: 100, y: 90, width: 8, height: 9 },
    ]);
  });

  it("join root predictions với result theo sampleId như payload FOMO thực tế", () => {
    const result = normalizeEdgeImpulseResponse({
      success: true,
      accuracy: { accuracyScore: 0.3613, allLabels: ["backpack", "human", "package"] },
      result: [
        {
          sampleId: 106,
          sample: {
            id: 106,
            filename: "project-sample.jpg",
            category: "testing",
            boundingBoxes: [{ label: "backpack", x: 11, y: 12, width: 20, height: 22 }],
          },
          classifications: [{ result: [], expectedLabels: [] }],
        },
      ],
      predictions: [
        {
          sampleId: 106,
          prediction: "backpack",
          predictionCorrect: true,
          f1Score: 100,
          boundingBoxes: [
            { label: "backpack", x: 180, y: 170, width: 19, height: 21, score: 0.87 },
          ],
        },
      ],
    });
    expect(result.samples[0].predictions).toEqual([
      { label: "backpack", x: 180, y: 170, width: 19, height: 21, score: 0.87 },
    ]);
  });

  it("đọc labelMapPredictions và deduplicate prediction", () => {
    const result = normalizeEdgeImpulseResponse({
      result: [
        {
          sample: { id: 2, filename: "map.jpg", boundingBoxes: [] },
          boundingBoxes: [{ label: "human", score: 0.75 }],
          structuredResult: {
            boundingBoxes: [{ label: "human", score: 0.75 }],
            labelMapPredictions: { package: 0.61 },
          },
        },
      ],
    });
    expect(result.samples[0].predictions).toEqual([
      { label: "human", score: 0.75, x: undefined, y: undefined, width: undefined, height: undefined },
      { label: "package", score: 0.61 },
    ]);
  });

  it("chặn báo cáo nếu upstream có accuracy nhưng parser không đọc được prediction", () => {
    expect(() =>
      normalizeEdgeImpulseResponse({
        accuracy: { accuracyScore: 0.3613 },
        result: [{ sample: { id: 1, filename: "broken.jpg", boundingBoxes: [{ label: "human" }] } }],
      }),
    ).toThrow(/không đọc được prediction nào/i);
  });

  it("fixture Demo có ảnh visual local cho mọi sample", () => {
    const result = normalizeEdgeImpulseResponse(demo);
    expect(
      result.samples.every((sample) => sample.thumbnailUrl?.startsWith("/demo/")),
    ).toBe(true);
  });

  it("payload malformed tạo lỗi tiếng Việt dễ hiểu", () => {
    expect(() => normalizeEdgeImpulseResponse([])).toThrow(/không đúng cấu trúc/i);
    expect(() => normalizeEdgeImpulseResponse({ success: true })).toThrow(/không chứa sample/i);
  });

  it("không đưa API key vào normalized output", () => {
    const secret = "ei_super_secret_key_123456789";
    const payload = { ...demo, apiKey: secret };
    expect(JSON.stringify(normalizeEdgeImpulseResponse(payload))).not.toContain(secret);
  });
});
