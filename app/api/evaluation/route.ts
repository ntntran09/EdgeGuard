import { EdgeImpulseError } from "@/lib/edge-impulse/client";
import { loadEvaluationDataset } from "@/lib/edge-impulse/evaluation";
import {
  EDGE_IMPULSE_SESSION_COOKIE,
  getEdgeImpulseSession,
  toSafeProjectConfiguration,
} from "@/lib/edge-impulse/session";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.cookies.get(EDGE_IMPULSE_SESSION_COOKIE)?.value;
    const session = getEdgeImpulseSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Phiên Edge Impulse đã hết hạn. Hãy cấu hình lại project.", code: "NO_SESSION" },
        { status: 401 },
      );
    }
    const dataset = await loadEvaluationDataset(session, sessionId);
    return NextResponse.json({
      ok: true,
      ...dataset,
      config: toSafeProjectConfiguration(session),
      source: "edge-impulse",
    });
  } catch (error) {
    const safe =
      error instanceof EdgeImpulseError
        ? error
        : new EdgeImpulseError("Không thể tải dữ liệu Model Testing từ Edge Impulse.", "EVALUATION_FAILED", 502);
    return NextResponse.json({ ok: false, error: safe.message, code: safe.code }, { status: safe.status });
  }
}
