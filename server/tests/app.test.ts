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
  buildOpenClawPresetRecommendations: vi.fn().mockReturnValue([
    { model: "openrouter/demo-model", preset: "coding", reason: "best coding model" },
  ]),
  summarizeProviderCoverage: vi.fn().mockReturnValue({
    modelsByProvider: { openrouter: 1 },
    totalModels: 1,
  }),
}));

const { createApiApp } = await import("../app");

const originalAllowedProxyDomains = process.env.ALLOWED_PROXY_DOMAINS;
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
  });

  it("returns discovery metadata", async () => {
    const app = createApiApp();
    const response = await app.request("/openclaw/discovery");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.provider.id).toBe("modelhub");
    expect(body.auth.methods).toEqual(expect.arrayContaining(["api_key"]));
    expect(body.onboarding.presets).toHaveLength(1);
  });

  it("returns status with provider credential coverage", async () => {
    process.env.REQUIRE_AUTH = "true";
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce({ id: "k1", userId: "u1", expiresAt: null });
    mockPrisma.providerCredential.findMany.mockResolvedValueOnce([
      { providerId: "openrouter" },
      { providerId: "openrouter" },
    ]);

    const app = createApiApp();
    const response = await app.request("/openclaw/status", {
      headers: { Authorization: "Bearer sk-test" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.id).toBe("u1");
    expect(body.providers).toEqual(expect.any(Array));
  });
});
