import { EDGE_IMPULSE_CONFIG, SUPPORTED_LABEL_LIST } from "@/lib/constants/fomo";
import { EdgeImpulseError, getModelTestingResults } from "@/lib/edge-impulse/client";
import { normalizeEdgeImpulseResponse } from "@/lib/edge-impulse/normalize";
import {
  clearEvaluationCachesForProject,
  createEdgeImpulseSession,
  deleteEdgeImpulseSession,
  EDGE_IMPULSE_SESSION_COOKIE,
  getEdgeImpulseSession,
  toSafeProjectConfiguration,
} from "@/lib/edge-impulse/session";
import { redactSecrets } from "@/lib/security/redact";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const SUPPORTED_LABEL_VALUES: readonly string[] = SUPPORTED_LABEL_LIST;

const configureProjectSchema = z
  .object({
    projectId: z.coerce.number().int().positive(),
    apiKey: z.string().trim().min(10),
    confidenceThreshold: z.number().min(0).max(1),
  })
  .strict();

function validateProjectLabels(classes: string[]): string[] {
  const classSet = new Set(classes);
  const missing = SUPPORTED_LABEL_LIST.filter((label) => !classSet.has(label));
  if (missing.length) {
    throw new EdgeImpulseError(
      "Project không có đủ ba class bắt buộc: human, package và backpack.",
      "REQUIRED_LABELS_MISSING",
      400,
    );
  }
  return classes.some((label) => !SUPPORTED_LABEL_VALUES.includes(label))
    ? [
        "Project chứa class ngoài human, package và backpack. Các class ngoài phạm vi sẽ không được dùng trong custom metric.",
      ]
    : [];
}

export async function POST(request: Request) {
  let requestApiKey = "";
  try {
    const parsed = configureProjectSchema.parse(await request.json());
    requestApiKey = parsed.apiKey;
    const payload = await getModelTestingResults({
      projectId: parsed.projectId,
      apiKey: parsed.apiKey,
    });
    const normalized = normalizeEdgeImpulseResponse(payload);
    const warnings = validateProjectLabels(normalized.classes);
    if (normalized.availableVariants.length && !normalized.availableVariants.includes(EDGE_IMPULSE_CONFIG.modelVariant)) {
      throw new EdgeImpulseError("Impulse 1 không có model variant int8.", "MODEL_VARIANT_MISSING", 400);
    }
    const sessionId = createEdgeImpulseSession(parsed);
    const session = getEdgeImpulseSession(sessionId);
    if (!session) {
      throw new EdgeImpulseError("Không thể tạo phiên cấu hình.", "SESSION_CREATE_FAILED", 500);
    }
    const response = NextResponse.json({
      ok: true,
      config: toSafeProjectConfiguration(session),
      sampleCount: normalized.samples.length,
      warnings: [...normalized.warnings, ...warnings],
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
        : error instanceof z.ZodError
          ? new EdgeImpulseError("Cấu hình project không hợp lệ.", "INVALID_SESSION_CONFIG", 400)
          : new EdgeImpulseError(
              error instanceof Error ? error.message : "Không thể kết nối project.",
              "SESSION_CONFIG_FAILED",
              400,
            );
    return NextResponse.json(
      { ok: false, error: redactSecrets(safe.message, [requestApiKey]), code: safe.code },
      { status: safe.status },
    );
  }
}

export async function GET(request: NextRequest) {
  const session = getEdgeImpulseSession(request.cookies.get(EDGE_IMPULSE_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Chưa có cấu hình project.", code: "NO_SESSION_CONFIG" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, config: toSafeProjectConfiguration(session) });
}

export async function DELETE(request: NextRequest) {
  const sessionId = request.cookies.get(EDGE_IMPULSE_SESSION_COOKIE)?.value;
  const session = getEdgeImpulseSession(sessionId);
  clearEvaluationCachesForProject(session?.projectId);
  deleteEdgeImpulseSession(sessionId);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(EDGE_IMPULSE_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return response;
}
