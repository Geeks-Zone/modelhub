import { cors } from "hono/cors";
import type { Context, MiddlewareHandler } from "hono";

import { auth } from "@/lib/auth/server";
import { isProviderEnabled } from "./catalog";
import { prisma } from "./db";
import { hashApiKey } from "./crypto";

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitRecord>();
const DEV_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:4000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4000",
];

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

function getAllowedOrigins(): string[] {
  const configuredOrigins = parseCsv(process.env.ALLOWED_ORIGINS).map(normalizeOrigin);
  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (isProductionEnv()) {
    return [];
  }

  return DEV_ALLOWED_ORIGINS.map(normalizeOrigin);
}

function resolveCorsOrigin(origin: string): string | null {
  if (!origin) {
    return null;
  }

  const allowed = getAllowedOrigins();
  if (allowed.includes("*")) {
    return origin;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  return allowed.includes(normalizedOrigin) ? origin : null;
}

export const protectedCors = cors({
  allowHeaders: ["Content-Type", "Authorization", "X-Proxy-Auth", "X-Provider-Credentials"],
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  credentials: true,
  maxAge: 86400,
  origin: resolveCorsOrigin,
});

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
};

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

function isDebugEnabled(): boolean {
  return process.env.ALLOW_DEBUG_ENDPOINTS === "true" || !isProductionEnv();
}

export function isAccessProtectionEnabled(): boolean {
  return process.env.REQUIRE_AUTH !== "false";
}

function jsonError(status: number, error: string, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }

  return new Response(JSON.stringify({ error }), { headers, status });
}

function extractBearerToken(c: Context): string | undefined {
  const auth = c.req.header("Authorization");
  if (!auth) return undefined;
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (auth.startsWith("sk-")) return auth.trim();
  return undefined;
}

async function getActiveApiKey(
  token: string,
): Promise<{ id: string; userId: string; expiresAt: Date | null } | null> {
  return prisma.apiKey.findFirst({
    where: {
      isActive: true,
      key: hashApiKey(token),
    },
    select: {
      expiresAt: true,
      id: true,
      userId: true,
    },
  });
}

function attachApiKeyToContext(
  c: Context,
  apiKey: { id: string; userId: string; expiresAt: Date | null },
): Response | undefined {
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return jsonError(401, "API key has expired");
  }

  c.set("userId", apiKey.userId);
  c.set("apiKeyId", apiKey.id);

  prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return undefined;
}

export async function authenticateAccess(c: Context): Promise<Response | undefined> {
  const bearerToken = extractBearerToken(c);
  if (bearerToken) {
    const apiKey = await getActiveApiKey(bearerToken);
    if (!apiKey) {
      return jsonError(401, "Invalid or revoked API key");
    }

    return attachApiKeyToContext(c, apiKey);
  }

  // Try Neon Auth session (reads cookies via next/headers context)
  let sessionResult: Awaited<ReturnType<typeof auth.getSession>> | undefined;
  try {
    sessionResult = await auth.getSession();
  } catch (error) {
    // Neon Auth not available in this context (e.g. missing cookies header), fall through
    console.error("[auth] auth.getSession() failed:", error);
  }

  if (sessionResult?.data?.user) {
    const neonUser = sessionResult.data.user;

    // Auto-provision: ensure user exists in our database.
    // NOTE: this runs outside the auth try-catch so DB errors surface as 500
    // instead of being silently swallowed and returning 401.
    await prisma.user.upsert({
      where: { id: neonUser.id },
      update: { email: neonUser.email, name: neonUser.name ?? undefined },
      create: {
        id: neonUser.id,
        email: neonUser.email ?? "",
        name: neonUser.name ?? "User",
      },
    });

    c.set("userId", neonUser.id);
    c.set("sessionId", sessionResult.data.session.id);
    return undefined;
  }

  return jsonError(
    401,
    "Authentication required. Provide Authorization: Bearer <api-key> or a valid session",
  );
}

function getRateLimitWindowMs(): number {
  const configuredValue = Number(process.env.RATE_LIMIT_WINDOW_MS ?? "60000");
  return Number.isFinite(configuredValue) && configuredValue > 0 ? configuredValue : 60000;
}

function getRateLimitMax(): number {
  const configuredValue = Number(process.env.RATE_LIMIT_MAX ?? "60");
  return Number.isFinite(configuredValue) && configuredValue > 0 ? configuredValue : 60;
}

function getUserRateLimitMax(): number {
  const configuredValue = Number(process.env.USER_RATE_LIMIT_MAX ?? "120");
  return Number.isFinite(configuredValue) && configuredValue > 0 ? configuredValue : 120;
}

function getClientIdentifier(c: Context): string {
  const forwardedForHeader = c.req.header("x-forwarded-for");
  const forwardedFor = forwardedForHeader?.split(",")[0]?.trim();
  const connectingIp =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    forwardedFor ??
    c.req.header("origin");

  return connectingIp?.toLowerCase() || "anonymous";
}

function cleanupExpiredRateLimits(now: number): void {
  if (rateLimitStore.size < 512) {
    return;
  }

  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

function enforceRateLimit(c: Context, overrideKey?: string, overrideMax?: number): Response | undefined {
  const maxRequests = overrideMax ?? getRateLimitMax();
  const windowMs = getRateLimitWindowMs();
  const now = Date.now();
  cleanupExpiredRateLimits(now);

  const rateLimitKey = overrideKey ?? getClientIdentifier(c);
  const currentRecord = rateLimitStore.get(rateLimitKey);
  if (!currentRecord || currentRecord.resetAt <= now) {
    rateLimitStore.set(rateLimitKey, { count: 1, resetAt: now + windowMs });
    return undefined;
  }

  currentRecord.count += 1;
  if (currentRecord.count <= maxRequests) {
    rateLimitStore.set(rateLimitKey, currentRecord);
    return undefined;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((currentRecord.resetAt - now) / 1000));
  return jsonError(429, "Too many requests", {
    "Retry-After": String(retryAfterSeconds),
  });
}

export async function ensureProtectedAccess(
  c: Context,
  options?: {
    providerId?: string;
  },
): Promise<Response | undefined> {
  if (options?.providerId && !isProviderEnabled(options.providerId)) {
    return jsonError(404, "Provider not available");
  }

  const rateLimitError = enforceRateLimit(c);
  if (rateLimitError) return rateLimitError;

  if (isAccessProtectionEnabled()) {
    const authError = await authenticateAccess(c);
    if (authError) return authError;

    const apiKeyId = c.get("apiKeyId") as string | undefined;
    if (apiKeyId) {
      const keyRateLimitError = enforceRateLimit(c, `apikey:${apiKeyId}`, getUserRateLimitMax());
      if (keyRateLimitError) return keyRateLimitError;
    }

    const sessionId = c.get("sessionId") as string | undefined;
    if (!apiKeyId && sessionId) {
      const sessionRateLimitError = enforceRateLimit(
        c,
        `session:${sessionId}`,
        getUserRateLimitMax(),
      );
      if (sessionRateLimitError) return sessionRateLimitError;
    }
  }

  return undefined;
}

export async function ensureDebugAccess(
  c: Context,
  options?: {
    providerId?: string;
  },
): Promise<Response | undefined> {
  if (!isDebugEnabled()) {
    return jsonError(404, "Not found");
  }

  return ensureProtectedAccess(c, options);
}

