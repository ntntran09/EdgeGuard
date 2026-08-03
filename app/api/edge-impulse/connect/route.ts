import { EdgeImpulseError, getModelTestingResults } from "@/lib/edge-impulse/client";
import { normalizeEdgeImpulseResponse } from "@/lib/edge-impulse/normalize";
import { redactSecrets } from "@/lib/security/redact";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let requestApiKey = "";
  try {
    const body = (await request.json()) as { projectId?: string; apiKey?: string };
    const projectId = Number(body.projectId);
    const apiKey = body.apiKey?.trim() || "";
    requestApiKey = apiKey;
    const payload = await getModelTestingResults({ projectId, apiKey });
    const normalized = normalizeEdgeImpulseResponse(payload);
    return NextResponse.json({
      ok: true,
      projectId,
      availableVariants: normalized.availableVariants.length ? normalized.availableVariants : ["int8"],
      sampleCount: normalized.samples.length,
      warnings: normalized.warnings,
    });
  } catch (error) {
    const safe =
      error instanceof EdgeImpulseError
        ? error
        : new EdgeImpulseError(error instanceof Error ? error.message : "Không thể kiểm tra kết nối.", "CONNECT_FAILED", 400);
    return NextResponse.json(
      { ok: false, error: redactSecrets(safe.message, [requestApiKey]), code: safe.code },
      { status: safe.status },
    );
  }
}
