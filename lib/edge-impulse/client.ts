import { EDGE_IMPULSE_CONFIG } from "@/lib/constants/fomo";
import { redactSecrets } from "@/lib/security/redact";

const BASE_URL = "https://studio.edgeimpulse.com/v1";
const DEFAULT_TIMEOUT_MS = 20_000;

export type EdgeImpulseCredentials = { projectId: number; apiKey: string };

export class EdgeImpulseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "EdgeImpulseError";
  }
}

export function validateCredentials(credentials: EdgeImpulseCredentials) {
  if (!Number.isInteger(credentials.projectId) || credentials.projectId <= 0) {
    throw new EdgeImpulseError("Project ID không hợp lệ. Project ID chỉ gồm chữ số.", "INVALID_PROJECT_ID", 400);
  }
  if (credentials.apiKey.trim().length < 10) {
    throw new EdgeImpulseError("API key không hợp lệ hoặc quá ngắn.", "INVALID_API_KEY", 400);
  }
}

function friendlyError(status: number): EdgeImpulseError {
  if (status === 401 || status === 403)
    return new EdgeImpulseError("Không thể xác thực. Hãy kiểm tra Project ID và API key.", "UNAUTHORIZED", status);
  if (status === 404)
    return new EdgeImpulseError(
      "Không tìm thấy kết quả Model Testing. Hãy mở Edge Impulse Studio, vào Model testing, nhấn Classify all, chờ quá trình hoàn tất, sau đó thử tải lại.",
      "NO_MODEL_TESTING_RESULTS",
      404,
    );
  if (status === 429)
    return new EdgeImpulseError("Edge Impulse đang giới hạn tần suất. Hãy đợi một chút rồi thử lại.", "RATE_LIMITED", 429);
  if (status >= 500)
    return new EdgeImpulseError("Máy chủ Edge Impulse đang gặp lỗi. Hãy thử lại sau.", "UPSTREAM_SERVER_ERROR", 502);
  return new EdgeImpulseError("Edge Impulse từ chối yêu cầu.", "UPSTREAM_REQUEST_FAILED", 502);
}

async function request(
  credentials: EdgeImpulseCredentials,
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  validateCredentials(credentials);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Accept: "application/json", "x-api-key": credentials.apiKey, ...init.headers },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw friendlyError(response.status);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json"))
      throw new EdgeImpulseError("Edge Impulse trả về dữ liệu không phải JSON.", "INVALID_CONTENT_TYPE", 502);
    return await response.json();
  } catch (error) {
    const safeError =
      error instanceof EdgeImpulseError
        ? error
        : error instanceof DOMException && error.name === "AbortError"
          ? new EdgeImpulseError("Kết nối Edge Impulse đã hết thời gian chờ.", "NETWORK_TIMEOUT", 504)
          : new EdgeImpulseError("Không thể kết nối tới Edge Impulse. Hãy kiểm tra mạng.", "NETWORK_ERROR", 502);
    console.error({
      status: safeError.status,
      endpoint: path.split("?")[0],
      durationMs: Date.now() - started,
      errorCode: redactSecrets(safeError.code),
    });
    throw safeError;
  } finally {
    clearTimeout(timer);
  }
}

export function buildClassificationResultUrl(projectId: number): string {
  const params = new URLSearchParams({
    variant: EDGE_IMPULSE_CONFIG.modelVariant,
    impulseId: String(EDGE_IMPULSE_CONFIG.impulseId),
  });
  return `${BASE_URL}/api/${projectId}/classify/all/result?${params.toString()}`;
}

export function buildSampleInfoUrl(projectId: number, sampleId: number): string {
  const params = new URLSearchParams({
    impulseId: String(EDGE_IMPULSE_CONFIG.impulseId),
  });
  return `${BASE_URL}/api/${projectId}/raw-data/${sampleId}?${params.toString()}`;
}

export function buildSampleImageUrl(projectId: number, sampleId: number): string {
  const params = new URLSearchParams({
    impulseId: String(EDGE_IMPULSE_CONFIG.impulseId),
  });
  return `${BASE_URL}/api/${projectId}/raw-data/${sampleId}/image?${params.toString()}`;
}

export function buildRawSampleUrl(projectId: number, sampleId: number): string {
  return `${BASE_URL}/api/${projectId}/raw-data/${sampleId}/raw`;
}

export function buildShowClassificationUrl(projectId: number, sampleId: number): string {
  const params = new URLSearchParams({
    modelVariant: EDGE_IMPULSE_CONFIG.modelVariant,
    sampleId: String(sampleId),
  });
  return `https://studio.edgeimpulse.com/public/${projectId}/live/impulse/${EDGE_IMPULSE_CONFIG.impulseId}/classification?${params.toString()}`;
}

export function buildModelTestingUrl(projectId: number): string {
  return `https://studio.edgeimpulse.com/public/${projectId}/live/impulse/${EDGE_IMPULSE_CONFIG.impulseId}/validation`;
}

export function getModelTestingResults(
  credentials: EdgeImpulseCredentials,
): Promise<unknown> {
  const path = buildClassificationResultUrl(credentials.projectId).slice(BASE_URL.length);
  return request(credentials, path);
}

export async function getAllRawData(
  credentials: EdgeImpulseCredentials,
  category: "testing" | "validation",
  limit = 200,
): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let offset = 0; ; offset += limit) {
    const params = new URLSearchParams({
      category,
      limit: String(limit),
      offset: String(offset),
      impulseId: String(EDGE_IMPULSE_CONFIG.impulseId),
    });
    const path = `/api/${credentials.projectId}/raw-data?${params.toString()}`;
    const payload = await request(credentials, path);
    const record = payload as Record<string, unknown>;
    const page = [record.samples, record.data, record.items].find(Array.isArray) as unknown[] | undefined;
    if (!page?.length) break;
    items.push(...page);
    if (page.length < limit) break;
  }
  return items;
}

export function classifySample(credentials: EdgeImpulseCredentials, sampleId: string) {
  const path = `/api/${credentials.projectId}/classify/v2/${encodeURIComponent(sampleId)}`;
  return request(credentials, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelVariant: EDGE_IMPULSE_CONFIG.modelVariant }),
  });
}

export function detectImageContentType(bytes: ArrayBuffer, contentType = ""): string | null {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  if (normalized.startsWith("image/")) return normalized;
  const view = new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  ) return "image/png";
  if (
    view.length >= 12 &&
    String.fromCharCode(...view.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...view.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  if (view.length >= 3 && String.fromCharCode(...view.slice(0, 3)) === "GIF") return "image/gif";
  return null;
}

export async function getSampleImage(
  credentials: EdgeImpulseCredentials,
  sampleId: string,
  afterInputBlock = false,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  validateCredentials(credentials);
  if (!/^\d+$/.test(sampleId)) {
    throw new EdgeImpulseError("Sample ID không hợp lệ.", "INVALID_SAMPLE_ID", 400);
  }
  const sampleNumber = Number(sampleId);
  const imageUrl = new URL(buildSampleImageUrl(credentials.projectId, sampleNumber));
  if (afterInputBlock) imageUrl.searchParams.set("afterInputBlock", "true");
  const processedImageUrl = new URL(buildSampleImageUrl(credentials.projectId, sampleNumber));
  processedImageUrl.searchParams.set("afterInputBlock", "true");
  const rawUrl = new URL(buildRawSampleUrl(credentials.projectId, sampleNumber));
  const paths = [
    `${imageUrl.pathname}${imageUrl.search}`,
    ...(!afterInputBlock ? [`${processedImageUrl.pathname}${processedImageUrl.search}`] : []),
    `${rawUrl.pathname}${rawUrl.search}`,
  ];
  const path = paths[0];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "image/jpeg,image/png,image/webp,image/*,*/*", "x-api-key": credentials.apiKey },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw friendlyError(response.status);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new EdgeImpulseError(
        "Edge Impulse không trả về định dạng ảnh hợp lệ.",
        "INVALID_IMAGE_CONTENT_TYPE",
        502,
      );
    }
    return { bytes: await response.arrayBuffer(), contentType };
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      for (const fallbackPath of paths.slice(1)) {
        try {
          const response = await fetch(`${BASE_URL}${fallbackPath}`, {
            headers: { Accept: "image/jpeg,image/png,image/webp,image/*,*/*", "x-api-key": credentials.apiKey },
            signal: controller.signal,
            cache: "no-store",
          });
          if (!response.ok) continue;
          const bytes = await response.arrayBuffer();
          const contentType = detectImageContentType(bytes, response.headers.get("content-type") ?? "");
          if (contentType) return { bytes, contentType };
        } catch {
          // Try the next image source before surfacing the original error.
        }
      }
    }
    const safeError =
      error instanceof EdgeImpulseError
        ? error
        : error instanceof DOMException && error.name === "AbortError"
          ? new EdgeImpulseError("Tải ảnh đã hết thời gian chờ.", "IMAGE_TIMEOUT", 504)
          : new EdgeImpulseError("Không thể tải ảnh từ Edge Impulse.", "IMAGE_NETWORK_ERROR", 502);
    console.error({
      status: safeError.status,
      endpoint: path,
      durationMs: Date.now() - started,
      errorCode: safeError.code,
    });
    throw safeError;
  } finally {
    clearTimeout(timer);
  }
}
