import { EdgeImpulseError, getSampleImage } from "@/lib/edge-impulse/client";
import {
  EDGE_IMPULSE_SESSION_COOKIE,
  getEdgeImpulseSession,
} from "@/lib/edge-impulse/session";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sampleId: string }> },
) {
  try {
    const session = getEdgeImpulseSession(request.cookies.get(EDGE_IMPULSE_SESSION_COOKIE)?.value);
    if (!session) {
      return NextResponse.json(
        { error: "Phiên Edge Impulse đã hết hạn. Hãy cấu hình lại project.", code: "NO_SESSION" },
        { status: 401 },
      );
    }
    const { sampleId } = await params;
    const afterInputBlock = request.nextUrl.searchParams.get("afterInputBlock") === "true";
    const image = await getSampleImage(session, sampleId, afterInputBlock);
    return new NextResponse(image.bytes, {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const safe =
      error instanceof EdgeImpulseError
        ? error
        : new EdgeImpulseError("Không thể tải ảnh sample.", "SAMPLE_IMAGE_FAILED", 500);
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
