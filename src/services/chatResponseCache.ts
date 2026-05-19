import { createHash } from "node:crypto";
import path from "node:path";
import { loadOrCreateManifest } from "../document-store/manifest.js";
import { sessionRoot } from "../document-store/paths.js";
import { fileExists, readJson, writeJson } from "../utils/fs.js";

const CACHE_VERSION = 1;
const CACHE_SCOPE = "session-consecutive-exact";

type CacheableResponse = Record<string, unknown>;

export type ChatResponseCacheInput = {
  userId: string;
  sessionId: string;
  message: string;
  route: string;
  selectedAgent: string;
  llmConfigured: boolean;
};

type CachedChatResponse = {
  version: number;
  scope: typeof CACHE_SCOPE;
  messageHash: string;
  normalizedMessage: string;
  route: string;
  selectedAgent: string;
  llmConfigured: boolean;
  manifestFingerprint: string;
  createdAt: string;
  response: CacheableResponse;
};

type CacheMiss = {
  hit: false;
  cacheable: boolean;
  messageHash: string;
  manifestFingerprint: string;
};

type CacheHit = {
  hit: true;
  response: CacheableResponse;
};

function cachePath(userId: string, sessionId: string): string {
  return path.join(sessionRoot(userId, sessionId), "chat-response-cache.json");
}

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isCacheableRoute(route: string): boolean {
  return route !== "research" && route !== "hybrid";
}

async function manifestFingerprint(userId: string, sessionId: string): Promise<string> {
  const manifest = await loadOrCreateManifest(userId, sessionId);
  const fingerprintSource = manifest.files.map((file) => ({
    fileId: file.file_id,
    sha256: file.sha256,
    status: file.status,
    extractedAt: file.extracted_at,
    warnings: file.warnings,
    error: file.error,
  }));
  return sha256(JSON.stringify(fingerprintSource));
}

function withCacheMetadata(response: CacheableResponse, hit: boolean, createdAt?: string): CacheableResponse {
  return {
    ...response,
    cache: {
      hit,
      scope: CACHE_SCOPE,
      ...(createdAt ? { reusedAnswerFrom: createdAt } : {}),
    },
  };
}

export async function getCachedChatResponse(input: ChatResponseCacheInput): Promise<CacheHit | CacheMiss> {
  const normalizedMessage = normalizeMessage(input.message);
  const messageHash = sha256(normalizedMessage);
  const fingerprint = await manifestFingerprint(input.userId, input.sessionId);
  const cacheable = isCacheableRoute(input.route);

  if (!cacheable) {
    return { hit: false, cacheable, messageHash, manifestFingerprint: fingerprint };
  }

  const filePath = cachePath(input.userId, input.sessionId);
  if (!(await fileExists(filePath))) {
    return { hit: false, cacheable, messageHash, manifestFingerprint: fingerprint };
  }

  let cached: CachedChatResponse;
  try {
    cached = await readJson<CachedChatResponse>(filePath);
  } catch {
    return { hit: false, cacheable, messageHash, manifestFingerprint: fingerprint };
  }
  const matches =
    cached.version === CACHE_VERSION &&
    cached.scope === CACHE_SCOPE &&
    cached.messageHash === messageHash &&
    cached.normalizedMessage === normalizedMessage &&
    cached.route === input.route &&
    cached.selectedAgent === input.selectedAgent &&
    cached.llmConfigured === input.llmConfigured &&
    cached.manifestFingerprint === fingerprint;

  if (!matches) {
    return { hit: false, cacheable, messageHash, manifestFingerprint: fingerprint };
  }

  return { hit: true, response: withCacheMetadata(cached.response, true, cached.createdAt) };
}

export async function storeCachedChatResponse(
  input: ChatResponseCacheInput,
  response: CacheableResponse,
  cache: CacheMiss,
): Promise<CacheableResponse> {
  const responseWithMiss = withCacheMetadata(response, false);
  if (!cache.cacheable) return responseWithMiss;

  const normalizedMessage = normalizeMessage(input.message);
  const cached: CachedChatResponse = {
    version: CACHE_VERSION,
    scope: CACHE_SCOPE,
    messageHash: cache.messageHash,
    normalizedMessage,
    route: input.route,
    selectedAgent: input.selectedAgent,
    llmConfigured: input.llmConfigured,
    manifestFingerprint: cache.manifestFingerprint,
    createdAt: new Date().toISOString(),
    response,
  };
  await writeJson(cachePath(input.userId, input.sessionId), cached);
  return responseWithMiss;
}
