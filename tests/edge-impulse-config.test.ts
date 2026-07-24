import { EDGE_IMPULSE_CONFIG, SUPPORTED_LABEL_LIST } from "@/lib/constants/fomo";
import {
  buildClassificationResultUrl,
  buildModelTestingUrl,
  buildRawSampleUrl,
  buildSampleImageUrl,
  buildSampleInfoUrl,
  buildShowClassificationUrl,
  detectImageContentType,
} from "@/lib/edge-impulse/client";
import { describe, expect, it } from "vitest";

describe("Fixed Edge Impulse configuration", () => {
  it("keeps impulse and model variant fixed", () => {
    expect(EDGE_IMPULSE_CONFIG).toEqual({ impulseId: 1, modelVariant: "int8" });
    expect(SUPPORTED_LABEL_LIST).toEqual(["human", "package", "backpack"]);
  });

  it("uses the current project ID in API URLs", () => {
    expect(buildClassificationResultUrl(1066469)).toContain("/api/1066469/classify/all/result");
    expect(buildClassificationResultUrl(42)).toContain("/api/42/classify/all/result");
  });

  it("always includes fixed impulse ID and int8 variant", () => {
    const resultUrl = new URL(buildClassificationResultUrl(1066469));
    expect(resultUrl.searchParams.get("impulseId")).toBe("1");
    expect(resultUrl.searchParams.get("variant")).toBe("int8");
    expect(buildSampleInfoUrl(1066469, 7)).toContain("impulseId=1");
    expect(buildSampleImageUrl(1066469, 7)).toContain("impulseId=1");
    expect(buildSampleImageUrl(1066469, 7, { includeImpulseId: false })).toBe("https://studio.edgeimpulse.com/v1/api/1066469/raw-data/7/image");
    expect(buildSampleImageUrl(1066469, 7, { afterInputBlock: true })).toContain("afterInputBlock=true");
    expect(buildRawSampleUrl(1066469, 7)).toBe("https://studio.edgeimpulse.com/v1/api/1066469/raw-data/7/raw");
    expect(buildShowClassificationUrl(1066469, 7)).toContain("/public/1066469/live/impulse/1/classification");
    expect(buildShowClassificationUrl(1066469, 7)).toContain("modelVariant=int8");
    expect(buildModelTestingUrl(1066469)).toBe("https://studio.edgeimpulse.com/public/1066469/live/impulse/1/validation");
  });

  it("detects image content type from headers or magic bytes", () => {
    expect(detectImageContentType(new Uint8Array([1, 2, 3]).buffer, "image/jpeg; charset=binary")).toBeNull();
    expect(detectImageContentType(new Uint8Array([0xff, 0xd8, 0xff, 0x00]).buffer, "application/octet-stream")).toBe("image/jpeg");
    expect(detectImageContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer)).toBe("image/png");
    expect(detectImageContentType(new Uint8Array([1, 2, 3]).buffer, "application/json")).toBeNull();
  });
});
