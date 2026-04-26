import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/registry", () => ({
  getProviderModels: vi.fn().mockImplementation(async (
    providerId: string,
    options?: { credentials?: Record<string, string> },
  ) => {
    if (providerId === "cerebras") {
      if (options?.credentials?.CEREBRAS_API_KEY) {
        return [
          {
            capabilities: { documents: true, images: false, tools: true },
            id: "qwen-3-235b-a22b-instruct-2507",
            name: "Qwen 3 235B",
          },
        ];
      }

      return [
        { capabilities: { documents: true, images: false, tools: false }, id: "llama3.1-8b", name: "Llama 3.1 8B" },
      ];
    }

    if (providerId === "openrouter") {
      return [
        { capabilities: { documents: true, images: false, tools: true }, id: "openai/gpt-oss-20b:free", name: "GPT OSS 20B" },
      ];
    }

    return [
      { capabilities: { documents: true, images: true, tools: true }, id: "gpt-4.1-128k", name: "GPT 4.1" },
    ];
  }),
  providerRegistry: {
    cerebras: { handler: vi.fn(), models: [] },
    openrouter: { handler: vi.fn(), models: [] },
    groq: { handler: vi.fn(), models: [] },
  },
}));

vi.mock("../lib/catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/catalog")>();
  return {
    ...original,
    isProviderEnabled: vi.fn().mockReturnValue(true),
  };
});

const {
  buildOpenClawCatalog,
  buildOpenClawConfig,
  buildOpenClawPresetRecommendations,
  clearOpenClawCatalogCache,
  getOpenClawCatalogCacheStats,
  summarizeProviderCoverage,
} = await import("../lib/openclaw");

describe("openclaw catalog helpers", () => {
  beforeEach(() => {
    clearOpenClawCatalogCache();
  });

  it("builds catalog only with tool-capable models", async () => {
    const catalog = await buildOpenClawCatalog();

    expect(catalog).toHaveLength(2);
    expect(catalog.every((model) => model.capabilities.tools === true)).toBe(true);
    expect(catalog.some((model) => model.pricingTier === "free")).toBe(true);
  });

  it("excludes models without tools capability", async () => {
    const catalog = await buildOpenClawCatalog();
    const cerebrasModel = catalog.find((item) => item.unifiedModelId === "cerebras/llama3.1-8b");

    expect(cerebrasModel).toBeUndefined();
  });

  it("uses user credentials when building a scoped provider catalog", async () => {
    const catalog = await buildOpenClawCatalog({
      cacheKeySuffix: "user-with-cerebras",
      providerCredentials: { cerebras: { CEREBRAS_API_KEY: "csk-test" } },
      providerIds: ["cerebras"],
    });

    expect(catalog.map((model) => model.unifiedModelId)).toEqual([
      "cerebras/qwen-3-235b-a22b-instruct-2507",
    ]);
  });

  it("formats model names as Provider: Model", async () => {
    const catalog = await buildOpenClawCatalog();

    expect(catalog.some((model) => model.name.includes(": "))).toBe(true);
  });

  it("sorts catalog by provider then model", async () => {
    const catalog = await buildOpenClawCatalog();

    for (let i = 1; i < catalog.length; i++) {
      const prev = catalog[i - 1]!;
      const curr = catalog[i]!;
      const providerCmp = prev.providerId.localeCompare(curr.providerId);
      if (providerCmp === 0) {
        expect(prev.modelId.localeCompare(curr.modelId)).toBeLessThanOrEqual(0);
      } else {
        expect(providerCmp).toBeLessThan(0);
      }
    }
  });

  it("computes preset recommendations", async () => {
    const catalog = await buildOpenClawCatalog();
    const presets = buildOpenClawPresetRecommendations(catalog);

    expect(presets).toHaveLength(4);
    expect(presets.map((item) => item.preset)).toEqual(
      expect.arrayContaining(["coding", "agentic", "low-cost", "long-context"]),
    );
  });

  it("summarizes provider coverage for tool-capable models only", async () => {
    const catalog = await buildOpenClawCatalog();
    const summary = summarizeProviderCoverage(catalog);

    expect(summary.totalModels).toBe(2);
    expect(summary.modelsByProvider).toEqual({
      groq: 1,
      openrouter: 1,
    });
  });

  it("builds config without compat flags for tool-capable models", async () => {
    const catalog = await buildOpenClawCatalog();
    const config = buildOpenClawConfig(
      catalog,
      buildOpenClawPresetRecommendations(catalog),
      "https://www.modelhub.com.br/v1",
    );

    for (const model of config.models.providers.modelhub.models) {
      expect(model).not.toHaveProperty("compat");
    }
  });

  it("prunes small-context models (<32k) from the OpenClaw fallback chain", async () => {
    const catalog = [
      {
        capabilities: { documents: true, images: false, reasoning: "basic", tools: true },
        contextWindow: 8192,
        id: "gpt-oss-120b",
        latencyTier: "high",
        maxTokens: null,
        modelId: "gpt-oss-120b",
        name: "Cerebras: GPT OSS 120B",
        presets: ["coding"],
        pricingTier: "standard",
        providerId: "cerebras",
        unifiedModelId: "cerebras/gpt-oss-120b",
      },
      {
        capabilities: { documents: true, images: false, reasoning: "advanced", tools: true },
        contextWindow: 131072,
        id: "z-ai/glm-5.1",
        latencyTier: "medium",
        maxTokens: null,
        modelId: "z-ai/glm-5.1",
        name: "NVIDIA NIM: GLM 5.1",
        presets: ["coding", "agentic", "long-context"],
        pricingTier: "standard",
        providerId: "nvidianim",
        unifiedModelId: "nvidianim/z-ai/glm-5.1",
      },
    ] as Parameters<typeof buildOpenClawConfig>[0];

    const presets = [
      { model: "nvidianim/z-ai/glm-5.1", preset: "coding" as const, reason: "" },
      { model: "cerebras/gpt-oss-120b", preset: "agentic" as const, reason: "" },
      { model: "nvidianim/z-ai/glm-5.1", preset: "long-context" as const, reason: "" },
      { model: "cerebras/gpt-oss-120b", preset: "low-cost" as const, reason: "" },
    ];

    const config = buildOpenClawConfig(catalog, presets, "https://www.modelhub.com.br/v1");

    expect(config.agents.defaults.model.primary).toBe("nvidianim/z-ai/glm-5.1");
    expect(config.agents.defaults.model.fallbacks).not.toContain("cerebras/gpt-oss-120b");
  });

  it("evicts catalog cache entries when the LRU cap is reached", async () => {
    const maxEntries = getOpenClawCatalogCacheStats().maxEntries;

    for (let i = 0; i < 10_000; i += 1) {
      await buildOpenClawCatalog({
        cacheKeySuffix: `user-${i}`,
        providerIds: ["openrouter"],
      });
    }

    expect(getOpenClawCatalogCacheStats().size).toBeLessThanOrEqual(maxEntries);
  });
});
