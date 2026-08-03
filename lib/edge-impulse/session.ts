import "server-only";

import { randomUUID } from "node:crypto";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  EDGE_IMPULSE_CONFIG,
  SUPPORTED_LABEL_LIST,
} from "@/lib/constants/fomo";

export type ServerSession = {
  projectId: number;
  apiKey: string;
  confidenceThreshold: number;
  createdAt: number;
  expiresAt: number;
};

export type SafeProjectConfiguration = {
  projectId: number;
  confidenceThreshold: number;
  hasApiKey: boolean;
  impulseId: typeof EDGE_IMPULSE_CONFIG.impulseId;
  modelVariant: typeof EDGE_IMPULSE_CONFIG.modelVariant;
  supportedLabels: typeof SUPPORTED_LABEL_LIST;
};

type ImageSourceMetadata = {
  url?: string;
  filename?: string;
};

const SESSION_TTL_MS = 30 * 60 * 1000;
const globalSessions = globalThis as typeof globalThis & {
  __presenceEdgeImpulseSessions?: Map<string, ServerSession>;
  __presenceEdgeImpulseImageSources?: Map<string, Map<string, ImageSourceMetadata>>;
};

const sessions =
  globalSessions.__presenceEdgeImpulseSessions ??
  (globalSessions.__presenceEdgeImpulseSessions = new Map<string, ServerSession>());
const imageSources =
  globalSessions.__presenceEdgeImpulseImageSources ??
  (globalSessions.__presenceEdgeImpulseImageSources = new Map<string, Map<string, ImageSourceMetadata>>());

function removeExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
      imageSources.delete(id);
    }
  }
}

export function createEdgeImpulseSession(config: {
  projectId: number;
  apiKey: string;
  confidenceThreshold?: number;
}): string {
  removeExpiredSessions();
  const id = randomUUID();
  const now = Date.now();
  sessions.set(id, {
    projectId: config.projectId,
    apiKey: config.apiKey,
    confidenceThreshold: config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return id;
}

export function getEdgeImpulseSession(id: string | undefined): ServerSession | null {
  if (!id) return null;
  removeExpiredSessions();
  const session = sessions.get(id);
  if (!session) return null;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { ...session };
}

export function updateEdgeImpulseSession(
  id: string | undefined,
  patch: Partial<Pick<ServerSession, "confidenceThreshold">>,
): ServerSession | null {
  if (!id) return null;
  removeExpiredSessions();
  const session = sessions.get(id);
  if (!session) return null;
  const next = { ...session, ...patch, expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(id, next);
  return { ...next };
}

export function deleteEdgeImpulseSession(id: string | undefined): void {
  if (!id) return;
  sessions.delete(id);
  imageSources.delete(id);
}

export function clearEvaluationCachesForProject(projectId: number | undefined): void {
  void projectId;
  imageSources.clear();
}

export function setEdgeImpulseImageSources(
  sessionId: string | undefined,
  sources: Array<{ keys: string[]; url: string | undefined; filename?: string }>,
): void {
  if (!sessionId) return;
  const next = new Map<string, ImageSourceMetadata>();
  for (const source of sources) {
    for (const key of source.keys) {
      if (key) next.set(key, { url: source.url, filename: source.filename });
    }
  }
  imageSources.set(sessionId, next);
}

export function getEdgeImpulseImageSource(
  sessionId: string | undefined,
  key: string,
): string | undefined {
  if (!sessionId) return undefined;
  removeExpiredSessions();
  return imageSources.get(sessionId)?.get(key)?.url;
}

export function getEdgeImpulseImageMetadata(
  sessionId: string | undefined,
  key: string,
): ImageSourceMetadata | undefined {
  if (!sessionId) return undefined;
  removeExpiredSessions();
  return imageSources.get(sessionId)?.get(key);
}

export function toSafeProjectConfiguration(
  session: ServerSession,
): SafeProjectConfiguration {
  return {
    projectId: session.projectId,
    confidenceThreshold: session.confidenceThreshold,
    hasApiKey: session.apiKey.length > 0,
    impulseId: EDGE_IMPULSE_CONFIG.impulseId,
    modelVariant: EDGE_IMPULSE_CONFIG.modelVariant,
    supportedLabels: SUPPORTED_LABEL_LIST,
  };
}

export const EDGE_IMPULSE_SESSION_COOKIE = "presence-ei-session";
