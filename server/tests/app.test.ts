import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  apiKey: { findFirst: vi.fn(), update: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  conversation: { create: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  providerCredential: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  usageLog: { count: vi.fn(), create: vi.fn().mockReturnValue({ catch: vi.fn() }), findMany: vi.fn(), groupBy: vi.fn() },
  user: { findUnique: vi.fn(), upsert: vi.fn() },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));
vi.mock("../lib/crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/crypto")>();
  return {
    ...original,
    decryptCredential: vi.fn((value: string) => {
      if (value === "bad") {
        throw new Error("decrypt failed");
      }
      return value;
    }),
    hashApiKey: vi.fn((value: string) => `hash:${value}`),
  };
});
vi.mock("../lib/openclaw", () => ({
  buildOpenClawCatalog: vi.fn().mockResolvedValue([
    {
      capabilities: { documents: true, images: false, reasoning: "advanced", tools: true },
      contextWindow: 131072,
      id: "demo-model",
      latencyTier: "medium",
      modelId: "demo-model",
      name: "Demo Model",
      presets: ["coding", "agentic", "long-context"],
      pricingTier: "standard",
      providerId: "openrouter",
      unifiedModelId: "openrouter/demo-model",
    },
  ]),
  buildOpenClawConfig: vi.fn().mockReturnValue({
    agents: { defaults: { model: { fallbacks: [], primary: "openrouter/demo-model" }, models: {} } },
    models: { mode: "merge", providers: { modelhub: { api: "openai-completions", apiKey: "${MODELHUB_API_KEY}", baseUrl: "https://example.com/v1", models: [] } } },
  }),
  buildOpenClawPresetRecommendations: vi.fn().mockReturnValue([
    { model: "openrouter/demo-model", preset: "coding", reason: "best coding model" },
  ]),
  summarizeProviderCoverage: vi.fn().mockReturnValue({
    modelsByProvider: { openrouter: 1 },
    totalModels: 1,
  }),
}));

const { createApiApp } = await import("../app");
const openclawMock = await import("../lib/openclaw");

const originalAllowedProxyDomains = process.env.ALLOWED_PROXY_DOMAINS;
const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
const originalRequireAuth = process.env.REQUIRE_AUTH;

describe("custom model proxy", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_PROXY_DOMAINS;
    process.env.REQUIRE_AUTH = "false";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.ALLOWED_PROXY_DOMAINS = originalAllowedProxyDomains;
    process.env.REQUIRE_AUTH = originalRequireAuth;
  });

  it("returns 503 when the custom proxy is not configured", async () => {
    const app = createApiApp();

    const response = await app.request("/custom-model-proxy?url=https://example.com", {
      body: "{}",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Custom proxy is not configured" });
  });
});

describe("openclaw endpoints", () => {
  beforeEach(() => {
    process.env.REQUIRE_AUTH = "false";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.REQUIRE_AUTH = originalRequireAuth;
    if (originalOpenRouterApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
    }
  });

  it("returns discovery metadata", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const app = createApiApp();
    const response = await app.request("/openclaw/discovery");

    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Sunset")).toBe("Wed, 24 Jun 2026 00:00:00 GMT");
    expect(response.headers.get("Link")).toContain("/openclaw/manifest");
    const body = await response.json();
    expect(body.provider.id).toBe("modelhub");
    expect(body.auth.methods).toEqual(expect.arrayContaining(["api_key"]));
    expect(body.onboarding.presets).toHaveLength(1);
  });

  it("returns a complete manifest", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const app = createApiApp();
    const response = await app.request("/openclaw/manifest");

    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBeNull();
    const body = await response.json();
    expect(body.api.manifest).toMatch(/\/openclaw\/manifest$/);
    expect(body.catalog.models).toHaveLength(1);
    expect(body.catalog.presets).toHaveLength(1);
    expect(body.config.models.providers.modelhub).toBeDefined();
    expect(body.coverage.totalModels).toBe(1);
    expect(body.generatedAt).toEqual(expect.any(String));
  });

  it("returns operational health without building the catalog", async () => {
    const app = createApiApp();
    const response = await app.request("/openclaw/health");

    expect(response.status).toBe(200);
    expect(openclawMock.buildOpenClawCatalog).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.checks.map((check: { name: string }) => check.name)).toEqual(expect.arrayContaining(["auth", "providers"]));
  });

  it("returns status with provider credential coverage", async () => {
    process.env.REQUIRE_AUTH = "true";
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce({ id: "k1", userId: "u1", expiresAt: null });
    mockPrisma.providerCredential.findMany.mockResolvedValueOnce([
      { credentialKey: "OPENROUTER_API_KEY", credentialValue: "ok", providerId: "openrouter" },
    ]);

    const app = createApiApp();
    const response = await app.request("/openclaw/status", {
      headers: { Authorization: "Bearer sk-test" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.id).toBe("u1");
    expect(body.degraded).toBe(false);
    expect(body.providers).toEqual(expect.any(Array));
  });

  it("surfaces degraded providers when credential decryption fails", async () => {
    process.env.REQUIRE_AUTH = "true";
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce({ id: "k1", userId: "u1", expiresAt: null });
    mockPrisma.providerCredential.findMany.mockResolvedValueOnce([
      { credentialKey: "OPENROUTER_API_KEY", credentialValue: "bad", providerId: "openrouter" },
    ]);

    const app = createApiApp();
    const response = await app.request("/openclaw/status", {
      headers: { Authorization: "Bearer sk-test" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.degraded).toBe(true);
    expect(body.degradedProviders).toEqual([
      { credentialKey: "OPENROUTER_API_KEY", providerId: "openrouter", reason: "decrypt_failed" },
    ]);
  });
});
