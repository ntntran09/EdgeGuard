import { EDGE_IMPULSE_CONFIG, SUPPORTED_LABEL_LIST } from "@/lib/constants/fomo";
import {
  buildClassificationResultUrl,
  buildModelTestingUrl,
  buildSampleImageUrl,
  buildSampleInfoUrl,
  buildShowClassificationUrl,
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
    expect(buildShowClassificationUrl(1066469, 7)).toContain("/public/1066469/live/impulse/1/classification");
    expect(buildShowClassificationUrl(1066469, 7)).toContain("modelVariant=int8");
    expect(buildModelTestingUrl(1066469)).toBe("https://studio.edgeimpulse.com/public/1066469/live/impulse/1/validation");
  });
});
