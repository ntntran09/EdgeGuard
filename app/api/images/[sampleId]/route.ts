import { EdgeImpulseError, getAllRawData, getSampleImage, type EdgeImpulseCredentials } from "@/lib/edge-impulse/client";
import {
  EDGE_IMPULSE_SESSION_COOKIE,
  getEdgeImpulseImageSource,
  getEdgeImpulseSession,
} from "@/lib/edge-impulse/session";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const RAW_DATA_CATEGORIES = ["all", "testing", "validation", "training", "post-processing"] as const;
const IMAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const IMAGE_CACHE_MAX_ITEMS = 120;

type UnknownRecord = Record<string, unknown>;
type CachedImage = { bytes: ArrayBuffer; contentType: string; expiresAt: number };

const imageCache = new Map<string, CachedImage>();

function cacheKey(sessionId: string, sampleId: string, filename: string, afterInputBlock: boolean) {
  return [sessionId, sampleId, filename, afterInputBlock ? "after-input" : "raw"].join("|");
}

function cachedImage(key: string): CachedImage | undefined {
  const image = imageCache.get(key);
  if (!image) return undefined;
  if (image.expiresAt <= Date.now()) {
    imageCache.delete(key);
    return undefined;
  }
  return image;
}

function rememberImage(key: string, image: { bytes: ArrayBuffer; contentType: string }) {
  if (imageCache.size >= IMAGE_CACHE_MAX_ITEMS) {
    const oldestKey = imageCache.keys().next().value;
    if (oldestKey) imageCache.delete(oldestKey);
  }
  imageCache.set(key, {
    bytes: image.bytes,
    contentType: image.contentType,
    expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
  });
}

function imageResponse(image: { bytes: ArrayBuffer; contentType: string }) {
  return new NextResponse(image.bytes, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === "string" && value.trim().length > 0);

const identifierValue = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
};

function filenameKey(filename: string): string {
  const basename = filename.trim().toLowerCase().replace(/\\/g, "/").split("/").pop() ?? filename.trim().toLowerCase();
  return basename
    .replace(/\.(json|cbor)$/i, "")
    .replace(/\.(jpe?g|png|webp|gif|bmp)$/i, "");
}

function filenameVariants(filename: string): string[] {
  const full = filename.trim();
  const key = filenameKey(full);
  const beforeRoboflowHash = key.split(".rf.")[0] ?? key;
  const restoredImageExtension = beforeRoboflowHash
    .replace(/_jpg$/i, ".jpg")
    .replace(/_jpeg$/i, ".jpeg")
    .replace(/_png$/i, ".png")
    .replace(/_webp$/i, ".webp");
  const numericPrefix = beforeRoboflowHash.match(/^\d+/)?.[0];
  return [...new Set([
    full,
    key,
    beforeRoboflowHash,
    restoredImageExtension,
    filenameKey(restoredImageExtension),
    numericPrefix,
  ].filter((value): value is string => Boolean(value)))];
}

function imageSourceFrom(value: unknown): { id?: string; url?: string; filename?: string } | null {
  if (!isRecord(value)) return null;
  const sample = isRecord(value.sample) ? value.sample : value;
  return {
    id: identifierValue(sample.id, sample.sampleId, value.id, value.sampleId),
    filename: stringValue(sample.filename, sample.name, value.filename, value.name),
    url: stringValue(
      sample.thumbnailUrl,
      sample.thumbnail,
      sample.thumbnailVideoFull,
      sample.thumbnailVideo,
      sample.imageUrl,
      sample.imageUrlFull,
      sample.videoUrlFull,
      sample.videoUrl,
      value.thumbnailUrl,
      value.thumbnail,
      value.thumbnailVideoFull,
      value.thumbnailVideo,
      value.imageUrl,
      value.imageUrlFull,
      value.videoUrlFull,
      value.videoUrl,
    ),
  };
}

async function findDataAcquisitionImage(
  credentials: EdgeImpulseCredentials,
  filename: string,
): Promise<{ id?: string; url?: string; terms: string[] } | null> {
  const root = filenameKey(filename);
  const terms = filenameVariants(filename);
  for (const category of RAW_DATA_CATEGORIES) {
    for (const term of terms) {
      for (const filters of [{ filename: term }, { search: term }]) {
        try {
          const items = await getAllRawData(credentials, category, 25, filters);
          const sources = items.map(imageSourceFrom).filter((source): source is NonNullable<typeof source> => Boolean(source));
          const exact =
            sources.find((source) => source.filename && filenameKey(source.filename) === root) ??
            sources.find((source) => source.filename && filenameKey(source.filename).includes(root)) ??
            sources.find((source) => source.filename && root.includes(filenameKey(source.filename)));
          if (exact?.id || exact?.url) return { id: exact.id, url: exact.url, terms };
          const first = sources.find((source) => source.id || source.url);
          if (first) return { id: first.id, url: first.url, terms };
        } catch {
          // Try the next category/filter pair.
        }
      }
    }
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sampleId: string }> },
) {
  let debugSampleId = "";
  let debugSourceUrl: string | undefined;
  let debugFilename = "";
  let debugSearchTerms: string[] = [];
  let debugLookupId: string | undefined;
  try {
    const sessionId = request.cookies.get(EDGE_IMPULSE_SESSION_COOKIE)?.value;
    const session = getEdgeImpulseSession(sessionId);
    if (!sessionId || !session) {
      return NextResponse.json(
        { error: "Phiên Edge Impulse đã hết hạn. Hãy cấu hình lại project.", code: "NO_SESSION" },
        { status: 401 },
      );
    }
    const { sampleId } = await params;
    debugSampleId = sampleId;
    const afterInputBlock = request.nextUrl.searchParams.get("afterInputBlock") === "true";
    const filename = request.nextUrl.searchParams.get("filename") ?? "";
    debugFilename = filename;
    const key = cacheKey(sessionId, sampleId, filename, afterInputBlock);
    const cached = cachedImage(key);
    if (cached) return imageResponse(cached);
    debugSearchTerms = filename ? filenameVariants(filename) : [];
    const directSourceUrl = getEdgeImpulseImageSource(sessionId, sampleId);
    const lookup = directSourceUrl || !filename ? null : await findDataAcquisitionImage(session, filename);
    debugLookupId = lookup?.id;
    debugSearchTerms = lookup?.terms ?? debugSearchTerms;
    const imageSampleId = lookup?.id ?? sampleId;
    const sourceUrl = directSourceUrl ?? getEdgeImpulseImageSource(sessionId, imageSampleId) ?? lookup?.url;
    debugSourceUrl = sourceUrl;
    debugSampleId = imageSampleId;
    const image = await getSampleImage(session, imageSampleId, afterInputBlock, sourceUrl ? [sourceUrl] : []);
    rememberImage(key, image);
    return imageResponse(image);
  } catch (error) {
    const safe =
      error instanceof EdgeImpulseError
        ? error
        : new EdgeImpulseError("Không thể tải ảnh sample.", "SAMPLE_IMAGE_FAILED", 500);
    let sourceHost: string | undefined;
    try {
      sourceHost = debugSourceUrl ? new URL(debugSourceUrl).hostname : undefined;
    } catch {
      sourceHost = "invalid-url";
    }
    return NextResponse.json(
      {
        error: safe.message,
        code: safe.code,
        sampleId: debugSampleId,
        filename: debugFilename || undefined,
        searchTerms: debugSearchTerms,
        lookupId: debugLookupId,
        hasMetadataSource: Boolean(debugSourceUrl),
        sourceHost,
        details: safe.details,
      },
      { status: safe.status },
    );
  }
}
