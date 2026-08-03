import {
  EdgeImpulseError,
  getSampleImage,
  type EdgeImpulseCredentials,
} from "@/lib/edge-impulse/client";
import {
  EDGE_IMPULSE_SESSION_COOKIE,
  getEdgeImpulseSession,
} from "@/lib/edge-impulse/session";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function credentialsFor(request: NextRequest): EdgeImpulseCredentials | null {
  const session = getEdgeImpulseSession(request.cookies.get(EDGE_IMPULSE_SESSION_COOKIE)?.value);
  if (session) return session;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const sampleId = request.nextUrl.searchParams.get("sampleId") ?? "";
    const afterInputBlock = request.nextUrl.searchParams.get("afterInputBlock") === "true";
    const credentials = credentialsFor(request);
    if (!credentials) {
      return NextResponse.json(
        { error: "Phiên Edge Impulse đã hết hạn. Hãy tải lại kết quả đánh giá." },
        { status: 401 },
      );
    }
    const image = await getSampleImage(credentials, sampleId, afterInputBlock);
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
