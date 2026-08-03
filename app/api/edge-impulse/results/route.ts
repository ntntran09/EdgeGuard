import { EdgeImpulseError, getAllRawData, getModelTestingResults } from "@/lib/edge-impulse/client";
import { normalizeEdgeImpulseResponse } from "@/lib/edge-impulse/normalize";
import {
  createEdgeImpulseSession,
  EDGE_IMPULSE_SESSION_COOKIE,
} from "@/lib/edge-impulse/session";
import { redactSecrets } from "@/lib/security/redact";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let requestApiKey = "";
  try {
    const body = (await request.json()) as {
      projectId?: string;
      apiKey?: string;
      dataset?: "testing" | "validation";
      variant?: string;
    };
    const dataset = body.dataset ?? "testing";
    const projectId = Number(body.projectId);
    const apiKey = body.apiKey?.trim() || "";
    requestApiKey = apiKey;
    const variant = "int8";
    const payload = await getModelTestingResults({ projectId, apiKey });
    const normalized = normalizeEdgeImpulseResponse(payload, dataset);
    if (normalized.samples.every((sample) => sample.groundTruthBoxes.length === 0)) {
      try {
        const rawItems = await getAllRawData({ projectId, apiKey }, dataset);
        if (rawItems.length) {
          const rawDataset = normalizeEdgeImpulseResponse({ samples: rawItems }, dataset);
          const groundTruthById = new Map(
            rawDataset.samples.map((sample) => [sample.id, sample.groundTruthBoxes]),
          );
          const groundTruthByName = new Map(
            rawDataset.samples.map((sample) => [sample.filename, sample.groundTruthBoxes]),
          );
          normalized.samples = normalized.samples.map((sample) => ({
            ...sample,
            groundTruthBoxes:
              groundTruthById.get(sample.id) ?? groundTruthByName.get(sample.filename) ?? [],
          }));
        }
      } catch {
        normalized.warnings.push(
          "Không thể tải Ground Truth từ raw-data; kết quả hiện tại chỉ dùng dữ liệu có trong Classify all.",
        );
      }
    }
    const samples = normalized.samples.filter(
      (sample) => !sample.category || sample.category === dataset,
    );
    if (!samples.length) {
      throw new EdgeImpulseError(`Dataset ${dataset} không có sample để đánh giá.`, "EMPTY_DATASET", 404);
    }
    if (normalized.availableVariants.length && !normalized.availableVariants.includes(variant)) {
      throw new EdgeImpulseError(`Model variant “${variant}” không tồn tại trong kết quả.`, "VARIANT_NOT_FOUND", 400);
    }
    const sessionId = createEdgeImpulseSession({ projectId, apiKey });
    const samplesWithImages = samples.map((sample) => ({
      ...sample,
      thumbnailUrl: `/api/edge-impulse/sample-image?sampleId=${encodeURIComponent(sample.id)}`,
    }));
    const response = NextResponse.json({
      ok: true,
      ...normalized,
      samples: samplesWithImages,
      source: "edge-impulse",
    });
    response.cookies.set(EDGE_IMPULSE_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 60,
      path: "/",
    });
    return response;
  } catch (error) {
    const safe =
      error instanceof EdgeImpulseError
        ? error
        : new EdgeImpulseError(error instanceof Error ? error.message : "Không thể tải dữ liệu.", "RESULTS_FAILED", 400);
    return NextResponse.json(
      { ok: false, error: redactSecrets(safe.message, [requestApiKey]), code: safe.code },
      { status: safe.status },
    );
  }
}
