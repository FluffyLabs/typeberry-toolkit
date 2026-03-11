// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_ARTIFACT_TTL_SECONDS = 48 * 60 * 60; // 48 hours default
const MAX_ARTIFACT_TTL_SECONDS = 48 * 60 * 60; // 48 hours max
const DEFAULT_MAX_ARTIFACT_SIZE_BYTES = 1024 * 1024; // 1 MB
const MIN_TTL_SECONDS = 60; // 1 minute min
const ARTIFACT_ID_NUM_BYTES = 12; // 96 bits = 24 hex chars

// Cleanup batch size
const CLEANUP_BATCH_SIZE = 100;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
}

interface R2ObjectBody {
  key: string;
  body: ReadableStream<Uint8Array> | null;
  size: number;
  customMetadata?: Record<string, string>;
  writeHttpMetadata: (headers: Headers) => void;
}

interface R2Bucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: R2PutOptions): Promise<R2ObjectBody>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2Objects>;
}

interface R2Objects {
  objects: R2ObjectBody[];
  truncated: boolean;
  cursor?: string;
}

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: Date;
}

interface Env {
  ARTIFACTS_BUCKET: R2Bucket;
  UPLOAD_RATE_LIMITER: RateLimiter;
  DOWNLOAD_RATE_LIMITER: RateLimiter;
  ARTIFACT_TTL_SECONDS?: string;
  MAX_ARTIFACT_TTL_SECONDS?: string;
  MAX_ARTIFACT_SIZE_BYTES?: string;
  PUBLIC_BASE_URL?: string;
  ALLOWED_ORIGINS?: string;
  USAGE_KILL_SWITCH?: string; // Set to "true" to disable the service
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Kill switch check
    if (env.USAGE_KILL_SWITCH === "true") {
      return new Response(JSON.stringify({ error: "Service temporarily disabled" }), {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    try {
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);

      // Health check (always available, even with kill switch)
      if (request.method === "GET" && path === "/healthz") {
        return jsonResponse(
          {
            ok: true,
            now: new Date().toISOString(),
            killSwitchActive: env.USAGE_KILL_SWITCH === "true",
          },
          200,
          request,
          env,
        );
      }

      if (request.method === "POST" && path === "/artifacts") {
        return await createArtifact(request, env);
      }

      const artifactMatch = path.match(/^\/artifacts\/([a-f0-9]{24})$/);
      if (request.method === "GET" && artifactMatch) {
        return await downloadArtifact(request, env, ctx, artifactMatch[1]);
      }

      return jsonResponse({ error: "Not found" }, 404, request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({ error: error.message }, error.status, request, env);
      }

      console.error("Unexpected worker error", error);
      return jsonResponse({ error: "Internal server error" }, 500, request, env);
    }
  },

  // Scheduled handler for cleanup (configure via cron trigger in wrangler.toml)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanupExpiredArtifacts(env));
  },
};

// ============================================================================
// HANDLERS
// ============================================================================

async function createArtifact(request: Request, env: Env): Promise<Response> {
  if (!request.body) {
    throw new HttpError(400, "Request body is required");
  }

  const url = new URL(request.url);
  const maxArtifactSize = toBoundedInt(
    env.MAX_ARTIFACT_SIZE_BYTES,
    DEFAULT_MAX_ARTIFACT_SIZE_BYTES,
    1,
    Number.MAX_SAFE_INTEGER,
  );

  // Early size check via Content-Length header
  const declaredLength = parsePositiveInt(request.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > maxArtifactSize) {
    throw new HttpError(413, `Artifact exceeds maximum size of ${maxArtifactSize} bytes`);
  }

  // Read body
  const payload = new Uint8Array(await request.arrayBuffer());
  if (payload.byteLength === 0) {
    throw new HttpError(400, "Artifact payload cannot be empty");
  }

  if (payload.byteLength > maxArtifactSize) {
    throw new HttpError(413, `Artifact exceeds maximum size of ${maxArtifactSize} bytes`);
  }

  // Rate limit by IP
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await env.UPLOAD_RATE_LIMITER.limit({ key: clientIp });
  if (!rateLimit.success) {
    throw new HttpError(429, "Rate limit exceeded. Please try again later.");
  }

  // Resolve TTL (max 48h)
  const ttlSeconds = resolveArtifactTtlSeconds(url, env);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
  const artifactId = generateArtifactId();

  await env.ARTIFACTS_BUCKET.put(artifactId, payload, {
    httpMetadata: {
      contentType: request.headers.get("content-type") ?? "application/octet-stream",
    },
    customMetadata: {
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      sizeBytes: String(payload.byteLength),
    },
  });

  const publicBaseUrl = resolvePublicBaseUrl(request, env);

  return jsonResponse(
    {
      artifactId,
      downloadUrl: `${publicBaseUrl}/artifacts/${artifactId}`,
      expiresAt: expiresAt.toISOString(),
      sizeBytes: payload.byteLength,
    },
    201,
    request,
    env,
  );
}

async function downloadArtifact(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  artifactId: string,
): Promise<Response> {
  if (!/^[a-f0-9]{24}$/.test(artifactId)) {
    throw new HttpError(400, "Invalid artifact ID");
  }

  const object = await env.ARTIFACTS_BUCKET.get(artifactId);
  if (!object) {
    throw new HttpError(404, "Artifact not found");
  }

  // Check expiration
  const expiresAt = object.customMetadata?.expiresAt;
  if (expiresAt) {
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isNaN(expiresAtMs) && expiresAtMs <= Date.now()) {
      ctx.waitUntil(env.ARTIFACTS_BUCKET.delete(artifactId));
      throw new HttpError(404, "Artifact expired");
    }
  }

  // Rate limit by IP
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await env.DOWNLOAD_RATE_LIMITER.limit({ key: clientIp });
  if (!rateLimit.success) {
    throw new HttpError(429, "Rate limit exceeded. Please try again later.");
  }

  // Build response headers
  const headers = corsHeaders(request, env);
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-artifact-id", artifactId);
  headers.set("x-artifact-size-bytes", String(object.size));

  if (expiresAt) {
    headers.set("x-artifact-expires-at", expiresAt);
  }

  return new Response(object.body, {
    status: 200,
    headers,
  });
}

// ============================================================================
// CLEANUP (Scheduled Handler)
// ============================================================================

async function cleanupExpiredArtifacts(env: Env): Promise<void> {
  const now = Date.now();
  let cursor: string | undefined;

  do {
    const listed = await env.ARTIFACTS_BUCKET.list({
      limit: CLEANUP_BATCH_SIZE,
      cursor,
    });

    const toDelete: string[] = [];

    for (const obj of listed.objects) {
      const expiresAt = obj.customMetadata?.expiresAt;
      if (expiresAt) {
        const expiresAtMs = Date.parse(expiresAt);
        if (!Number.isNaN(expiresAtMs) && expiresAtMs <= now) {
          toDelete.push(obj.key);
        }
      }
    }

    if (toDelete.length > 0) {
      await env.ARTIFACTS_BUCKET.delete(toDelete);
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

// ============================================================================
// UTILITIES
// ============================================================================

function resolveArtifactTtlSeconds(url: URL, env: Env): number {
  const maxTtl = toBoundedInt(
    env.MAX_ARTIFACT_TTL_SECONDS,
    MAX_ARTIFACT_TTL_SECONDS,
    MIN_TTL_SECONDS,
    MAX_ARTIFACT_TTL_SECONDS, // Hard cap at 48h
  );
  const defaultTtl = toBoundedInt(env.ARTIFACT_TTL_SECONDS, DEFAULT_ARTIFACT_TTL_SECONDS, MIN_TTL_SECONDS, maxTtl);
  const requestedTtl = toBoundedInt(url.searchParams.get("ttl"), defaultTtl, MIN_TTL_SECONDS, maxTtl);
  return requestedTtl;
}

function resolvePublicBaseUrl(request: Request, env: Env): string {
  const fallback = new URL(request.url).origin;
  const candidate = (env.PUBLIC_BASE_URL ?? fallback).trim();
  return candidate.replace(/\/+$/, "");
}

function normalizePath(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }
  return pathname.replace(/\/+$/, "");
}

// ============================================================================
// CORS & RESPONSE HELPERS
// ============================================================================

function jsonResponse(payload: unknown, status: number, request: Request, env: Env): Response {
  const headers = corsHeaders(request, env);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");

  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    headers.set("access-control-allow-origin", "*");
  } else {
    const origin = request.headers.get("origin");
    if (origin && allowedOrigins.includes(origin)) {
      headers.set("access-control-allow-origin", origin);
      headers.set("vary", "origin");
    }
  }

  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,x-requested-with");
  headers.set("access-control-max-age", "86400");

  return headers;
}

function parseAllowedOrigins(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ============================================================================
// ID GENERATION
// ============================================================================

function generateArtifactId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ARTIFACT_ID_NUM_BYTES));
  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// PARSING UTILITIES
// ============================================================================

function parsePositiveInt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function toBoundedInt(value: string | null | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}
