import "./env";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { Hono } from "hono";
import { z } from "zod";

import { getAvailableProviders, getProxyTarget } from "./lib/catalog";
import { getProviderFromResponse, logHttpRequest, resolveProviderFromPath } from "./lib/observability";
import { fetchWithTimeout, jsonErrorResponse } from "./lib/provider-core";
import {
  ensureDebugAccess,
  ensureProtectedAccess,
  isAccessProtectionEnabled,
  protectedCors,
  securityHeaders,
} from "./lib/security";
import { prisma } from "./lib/db";
import { decryptCredential } from "./lib/crypto";
import {
  buildOpenClawCatalog,
  buildOpenClawConfig,
  buildOpenClawPresetRecommendations,
  summarizeProviderCoverage,
} from "./lib/openclaw";
import { providerRegistry } from "./providers/registry";
import userFetch from "./routes/user";
import conversationsFetch from "./routes/conversations";
import v1Fetch from "./routes/v1";

type ApiAppEnv = {
  Variables: {
    apiKeyId: string;
    sessionId: string;
    userId: string;
  };
};

type OpenClawProviderAccess = {
  cacheKeySuffix: string;
  configuredCredentialCountsByProvider: Record<string, number>;
  configuredProviderIds: Set<string>;
  credentialCountsByProvider: Record<string, number>;
  credentialsByProvider: Record<string, Record<string, string>>;
  degradedProviders: OpenClawDegradedProvider[];
};

type OpenClawDegradedProvider = {
  credentialKey: string;
  providerId: string;
  reason: "decrypt_failed";
};

const OPENCLAW_DEPRECATION_SUNSET = "Wed, 24 Jun 2026 00:00:00 GMT";

function buildOpenClawProviderCacheKey(
  userId: string | undefined,
  credentialsByProvider: Record<string, Record<string, string>>,
): string {
  const credentialEntries = Object.entries(credentialsByProvider)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([providerId, credentials]) => [
      providerId,
      Object.entries(credentials).sort(([a], [b]) => a.localeCompare(b)),
    ]);
  const digest = createHash("sha256")
    .update(JSON.stringify(credentialEntries))
    .digest("base64url")
    .slice(0, 32);
  return `${userId ?? "env"}:${digest}`;
}

function setCredentialKey(
  map: Map<string, Set<string>>,
  providerId: string,
  credentialKey: string,
): void {
  let keys = map.get(providerId);
  if (!keys) {
    keys = new Set<string>();
    map.set(providerId, keys);
  }
  keys.add(credentialKey);
}

function countCredentialKey(record: Record<string, number>, providerId: string): void {
  record[providerId] = (record[providerId] ?? 0) + 1;
}

function countConfiguredCredentialKeys(map: Map<string, Set<string>>): Record<string, number> {
  return Object.fromEntries([...map.entries()].map(([providerId, keys]) => [providerId, keys.size]));
}

async function getOpenClawProviderAccess(userId: string | undefined): Promise<OpenClawProviderAccess> {
  const availableProviders = getAvailableProviders();
  const availableProviderIds = new Set(availableProviders.map((provider) => provider.id));
  const credentialKeysByProvider = new Map<string, Set<string>>();
  const credentialCountsByProvider: Record<string, number> = {};
  const credentialsByProvider: Record<string, Record<string, string>> = {};
  const degradedProviders: OpenClawDegradedProvider[] = [];

  if (userId && availableProviderIds.size > 0) {
    const rows = await prisma.providerCredential.findMany({
      where: { userId, providerId: { in: [...availableProviderIds] } },
      select: { credentialKey: true, credentialValue: true, providerId: true },
    });
    for (const row of rows) {
      if (typeof row.credentialKey !== "string" || !row.credentialKey) {
        continue;
      }

      if (typeof row.credentialValue !== "string" || !row.credentialValue) {
        continue;
      }

      countCredentialKey(credentialCountsByProvider, row.providerId);

      try {
        const decryptedValue = decryptCredential(row.credentialValue);
        credentialsByProvider[row.providerId] ??= {};
        credentialsByProvider[row.providerId][row.credentialKey] = decryptedValue;
        setCredentialKey(credentialKeysByProvider, row.providerId, row.credentialKey);
      } catch {
        degradedProviders.push({
          credentialKey: row.credentialKey,
          providerId: row.providerId,
          reason: "decrypt_failed",
        });
        console.error(`[openclaw] failed to decrypt credential "${row.credentialKey}" for provider ${row.providerId}`);
      }
    }
  }

  const configuredProviderIds = new Set(
    availableProviders
      .filter((provider) => {
        const requiredKeys = provider.requiredKeys?.map((key) => key.envName) ?? [];
        if (requiredKeys.length === 0) return true;
        if (requiredKeys.every((envName) => Boolean(process.env[envName]?.trim()))) return true;

        const configuredKeys = credentialKeysByProvider.get(provider.id) ?? new Set<string>();
        return requiredKeys.every((envName) => configuredKeys.has(envName));
      })
      .map((provider) => provider.id),
  );

  const configuredCredentialsByProvider = Object.fromEntries(
    Object.entries(credentialsByProvider).filter(([providerId]) => configuredProviderIds.has(providerId)),
  );

  return {
    cacheKeySuffix: buildOpenClawProviderCacheKey(userId, configuredCredentialsByProvider),
    configuredCredentialCountsByProvider: countConfiguredCredentialKeys(credentialKeysByProvider),
    configuredProviderIds,
    credentialCountsByProvider,
    credentialsByProvider: configuredCredentialsByProvider,
    degradedProviders,
  };
}

async function buildOpenClawCatalogContextForUser(userId: string | undefined) {
  const access = await getOpenClawProviderAccess(userId);
  const catalog = await buildOpenClawCatalog({
    cacheKeySuffix: access.cacheKeySuffix,
    providerCredentials: access.credentialsByProvider,
    providerIds: access.configuredProviderIds,
  });
  const filteredCatalog = catalog.filter((model) => access.configuredProviderIds.has(model.providerId));
  const presets = buildOpenClawPresetRecommendations(filteredCatalog);
  const summary = summarizeProviderCoverage(filteredCatalog);
  return {
    access,
    catalog: filteredCatalog,
    presets,
    summary,
  };
}

async function buildOpenClawCatalogForUser(userId: string | undefined) {
  const context = await buildOpenClawCatalogContextForUser(userId);
  return context.catalog;
}

function parseAllowedProxyDomains(): string[] {
  return (process.env.ALLOWED_PROXY_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateIpAddress(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    return (
      address.startsWith("127.") ||
      address.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
      address.startsWith("192.168.") ||
      address.startsWith("169.254.") ||
      address.startsWith("0.")
    );
  }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("::ffff:127.")
    );
  }

  return false;
}

async function hostnameResolvesToPublicIps(hostname: string): Promise<boolean> {
  if (isIP(hostname)) {
    return !isPrivateIpAddress(hostname);
  }

  try {
    const lookups = await lookup(hostname, { all: true, verbatim: true });
    if (lookups.length === 0) {
      return false;
    }

    return lookups.every((entry) => !isPrivateIpAddress(entry.address));
  } catch (error) {
    console.error("[custom-model-proxy] DNS resolution failed", error);
    return false;
  }
}

async function isUrlAllowed(rawUrl: string): Promise<boolean> {
  const allowedProxyDomains = parseAllowedProxyDomains();
  if (allowedProxyDomains.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== "443") return false;
    if (!allowedProxyDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return false;
    }

    return hostnameResolvesToPublicIps(hostname);
  } catch (error) {
    console.warn("[custom-model-proxy] invalid URL rejected", error);
    return false;
  }
}

function getProtectedRequestHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};

  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers["content-type"] = contentType;
  }

  const accept = request.headers.get("accept");
  if (accept) {
    headers.accept = accept;
  }

  return headers;
}

function sanitizeProxyResponseHeaders(responseHeaders: Headers): Headers {
  const sanitizedHeaders = new Headers(responseHeaders);
  sanitizedHeaders.delete("content-encoding");
  sanitizedHeaders.delete("content-length");
  sanitizedHeaders.delete("location");
  sanitizedHeaders.delete("set-cookie");
  sanitizedHeaders.delete("transfer-encoding");
  return sanitizedHeaders;
}

function resolveAuthenticatedVia(apiKeyId: string | undefined, sessionId: string | undefined): string {
  if (apiKeyId) return "api_key";
  if (sessionId) return "session_cookie";
  return "unknown";
}

function markOpenClawEndpointDeprecated(c: Context<ApiAppEnv>): void {
  c.header("Deprecation", "true");
  c.header("Sunset", OPENCLAW_DEPRECATION_SUNSET);
  c.header("Link", '</openclaw/manifest>; rel="successor-version"');
  console.info(
    `[openclaw-deprecated-endpoint] ${JSON.stringify({
      method: c.req.method,
      route: c.req.path,
      successor: "/openclaw/manifest",
    })}`,
  );
}

function buildOpenClawApiLinks(origin: string): Record<string, string> {
  return {
    baseUrl: `${origin}/v1`,
    catalog: `${origin}/openclaw/catalog`,
    chatCompletions: `${origin}/v1/chat/completions`,
    config: `${origin}/openclaw/config`,
    discovery: `${origin}/openclaw/discovery`,
    health: `${origin}/openclaw/health`,
    manifest: `${origin}/openclaw/manifest`,
    models: `${origin}/v1/models`,
    status: `${origin}/openclaw/status`,
  };
}

function buildOpenClawAuthInfo(): {
  bearerFormat: string;
  methods: string[];
  recommended: string;
} {
  return {
    bearerFormat: "Authorization: Bearer <modelhub-api-key>",
    methods: ["api_key"],
    recommended: "api_key",
  };
}

export function createApiApp() {
  const app = new Hono<ApiAppEnv>();

  /** Evita que falhas não tratadas cheguem ao Next.js como página HTML 500 (clientes OpenAI esperam JSON). */
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error("[api] unhandled error:", err);
    return c.json(
      {
        error: {
          message: err instanceof Error ? err.message : "Internal server error",
        },
      },
      500,
    );
  });

  app.use("*", securityHeaders);
  app.use(async (c, next) => {
    const startedAt = Date.now();
    await next();
    c.res.headers.set("X-Accel-Buffering", "no");
    logHttpRequest({
      durationMs: Date.now() - startedAt,
      method: c.req.method,
      provider: getProviderFromResponse(c.res) ?? resolveProviderFromPath(c.req.path),
      route: c.req.path,
      status: c.res.status,
    });
  });

  app.use("/v1/*", protectedCors);
  app.use("/providers/*", protectedCors);
  app.use("/:provider/*", protectedCors);
  app.use("/gateway/*", protectedCors);
  app.use("/embeddings/*", protectedCors);
  app.use("/openclaw/*", protectedCors);
  app.use("/custom-model-proxy", protectedCors);
  app.use("/debug", protectedCors);

  app.get("/", (c) => {
    return c.json({
      service: "ai-gateway-api",
      status: "ok",
      timestamp: Date.now(),
    });
  });

  app.get("/providers/catalog", (c) => {
    return c.json({
      authRequired: isAccessProtectionEnabled(),
      providers: getAvailableProviders(),
    });
  });

  app.get("/openclaw/manifest", async (c) => {
    const accessError = await ensureProtectedAccess(c);
    if (accessError) {
      return accessError;
    }

    const url = new URL(c.req.url);
    const api = buildOpenClawApiLinks(url.origin);
    const context = await buildOpenClawCatalogContextForUser(c.get("userId") as string | undefined);
    const config = buildOpenClawConfig(context.catalog, context.presets, api.baseUrl);

    return c.json({
      api,
      auth: buildOpenClawAuthInfo(),
      catalog: {
        models: context.catalog,
        presets: context.presets,
        summary: context.summary,
      },
      config,
      coverage: context.summary,
      degraded: context.access.degradedProviders.length > 0,
      degradedProviders: context.access.degradedProviders,
      generatedAt: new Date().toISOString(),
      onboarding: {
        headless: true,
        presets: context.presets,
        requiresOpenClawInstalled: true,
        supportsNativeProviderFlow: false,
      },
      provider: {
        id: "modelhub",
        modelCoverage: context.summary,
        name: "ModelHub",
        openaiCompatible: true,
      },
      version: "v2",
    });
  });

  app.get("/openclaw/discovery", async (c) => {
    const accessError = await ensureProtectedAccess(c);
    if (accessError) {
      return accessError;
    }

    markOpenClawEndpointDeprecated(c);
    const url = new URL(c.req.url);
    const api = buildOpenClawApiLinks(url.origin);
    const context = await buildOpenClawCatalogContextForUser(c.get("userId") as string | undefined);

    return c.json({
      api,
      auth: buildOpenClawAuthInfo(),
      onboarding: {
        headless: true,
        presets: context.presets,
        requiresOpenClawInstalled: true,
        supportsNativeProviderFlow: false,
      },
      provider: {
        id: "modelhub",
        modelCoverage: context.summary,
        name: "ModelHub",
        openaiCompatible: true,
      },
      version: "v1",
    });
  });

  app.get("/openclaw/catalog", async (c) => {
    const accessError = await ensureProtectedAccess(c);
    if (accessError) {
      return accessError;
    }

    markOpenClawEndpointDeprecated(c);
    const context = await buildOpenClawCatalogContextForUser(c.get("userId") as string | undefined);
    return c.json({
      generatedAt: new Date().toISOString(),
      models: context.catalog,
      presets: context.presets,
      summary: context.summary,
    });
  });

  app.get("/openclaw/status", async (c) => {
    const accessError = await ensureProtectedAccess(c);
    if (accessError) {
      return accessError;
    }

    const userId = c.get("userId") as string | undefined;
    const apiKeyId = c.get("apiKeyId") as string | undefined;
    const sessionId = c.get("sessionId") as string | undefined;
    markOpenClawEndpointDeprecated(c);
    const access = await getOpenClawProviderAccess(userId);
    const availableProviders = getAvailableProviders();

    const providers = availableProviders.map((provider) => {
      const requiredCount = provider.requiredKeys?.length ?? 0;
      const configuredCount = access.configuredCredentialCountsByProvider[provider.id] ?? 0;
      const storedCredentialCount = access.credentialCountsByProvider[provider.id] ?? 0;
      return {
        configured: requiredCount === 0 || configuredCount >= requiredCount,
        configuredCount,
        id: provider.id,
        label: provider.label,
        requiredCount,
        storedCredentialCount,
      };
    });

    return c.json({
      authenticated: Boolean(userId),
      authenticatedVia: resolveAuthenticatedVia(apiKeyId, sessionId),
      degraded: access.degradedProviders.length > 0,
      degradedProviders: access.degradedProviders,
      permissions: {
        canChatCompletions: true,
        canListModels: true,
      },
      providers,
      user: {
        apiKeyId: apiKeyId ?? null,
        id: userId ?? null,
      },
    });
  });

  app.get("/openclaw/health", async (c) => {
    const accessError = await ensureProtectedAccess(c);
    if (accessError) {
      return accessError;
    }

    const providers = getAvailableProviders();
    const checks: Array<{ name: string; ok: boolean; details?: string }> = [
      { name: "auth", ok: true },
      { name: "providers", ok: providers.length > 0, details: `providers=${providers.length}` },
    ];

    return c.json({
      checks,
      status: checks.every((check) => check.ok) ? "ok" : "degraded",
      timestamp: Date.now(),
    });
  });

  app.get("/openclaw/config", async (c) => {
    const accessError = await ensureProtectedAccess(c);
    if (accessError) {
      return accessError;
    }

    markOpenClawEndpointDeprecated(c);
    const url = new URL(c.req.url);
    const baseUrl = `${url.origin}/v1`;
    const catalog = await buildOpenClawCatalogForUser(c.get("userId") as string | undefined);
    const presets = buildOpenClawPresetRecommendations(catalog);
    const config = buildOpenClawConfig(catalog, presets, baseUrl);

    return c.json(config);
  });

  app.use("/user/*", async (c) => await userFetch(c.req.raw));
  app.use("/conversations/*", async (c) => await conversationsFetch(c.req.raw));
  app.use("/v1/*", async (c) => await v1Fetch(c.req.raw));

  app.use("/:provider/*", async (c, next) => {
    const providerId = c.req.param("provider");
    const handler = providerRegistry[providerId]?.handler;

    if (!handler) {
      await next();
      return;
    }

    const accessError = await ensureProtectedAccess(c, { providerId });
    if (accessError) {
      return accessError;
    }

    return handler(c.req.raw);
  });

  app.post(
    "/custom-model-proxy",
    zValidator(
      "query",
      z.object({
        url: z.url().max(2048),
      }),
    ),
    async (c) => {
      const accessError = await ensureProtectedAccess(c);
      if (accessError) {
        return accessError;
      }

      if (parseAllowedProxyDomains().length === 0) {
        return jsonErrorResponse(503, "Custom proxy is not configured");
      }

      const { url } = c.req.valid("query");
      if (!(await isUrlAllowed(url))) {
        return jsonErrorResponse(403, "URL not allowed by proxy policy");
      }

      const body = await c.req.text();
      const response = await fetchWithTimeout(
        url,
        {
          body,
          headers: getProtectedRequestHeaders(c.req.raw),
          method: c.req.method,
          redirect: "manual",
        },
        60000,
      );

      if (response.status >= 300 && response.status < 400) {
        return jsonErrorResponse(502, "Redirect responses are not allowed");
      }

      return new Response(response.body, {
        headers: sanitizeProxyResponseHeaders(response.headers),
        status: response.status,
      });
    },
  );

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: Date.now() });
  });

  app.get("/debug", async (c) => {
    const debugError = await ensureDebugAccess(c);
    if (debugError) {
      return debugError;
    }

    return c.json({ node: process.version, timestamp: Date.now(), version: "v4-hardened" });
  });

  app.use(async (c, next) => {
    try {
      const url = new URL(c.req.url);
      const matchedProxy = getProxyTarget(url.pathname);
      if (!matchedProxy) {
        await next();
        return;
      }

      const accessError = await ensureProtectedAccess(c);
      if (accessError) {
        return accessError;
      }

      const headers: Record<string, string> = {
        host: new URL(matchedProxy.target).hostname,
      };

      c.req.raw.headers.forEach((value, key) => {
        const normalizedKey = key.toLowerCase();
        if (
          !normalizedKey.startsWith("cf-") &&
          !normalizedKey.startsWith("x-forwarded-") &&
          !normalizedKey.startsWith("cdn-") &&
          normalizedKey !== "x-real-ip" &&
          normalizedKey !== "host" &&
          normalizedKey !== "accept-encoding"
        ) {
          headers[normalizedKey] = value;
        }
      });

      const targetUrl = `${matchedProxy.target}${url.pathname.replace(
        `/${matchedProxy.pathSegment}/`,
        "/",
      )}${url.search}`;
      const method = c.req.method.toUpperCase();
      const requestInit: RequestInit = { headers, method };
      if (method !== "GET" && method !== "HEAD") {
        requestInit.body = await c.req.text();
      }

      const response = await fetchWithTimeout(targetUrl, requestInit, 60000);
      return new Response(response.body, {
        headers: sanitizeProxyResponseHeaders(response.headers),
        status: response.status,
      });
    } catch (error) {
      console.error("Proxy error:", error);
      return jsonErrorResponse(500, "Internal proxy error");
    }
  });

  return app;
}

const app = createApiApp();

export default app;
