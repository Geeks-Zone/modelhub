import { describe, expect, it, vi } from "vitest";

vi.mock("../providers/registry", () => ({
  getProviderModels: vi.fn().mockImplementation(async (providerId: string) => {
    if (providerId === "openrouter") {
      return [
        { capabilities: { documents: true, images: false }, id: "openai/gpt-oss-20b:free", name: "GPT OSS 20B" },
      ];
    }

    return [
      { capabilities: { documents: true, images: true }, id: "gpt-4.1-128k", name: "GPT 4.1" },
    ];
  }),
  providerRegistry: {
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
  buildOpenClawPresetRecommendations,
  summarizeProviderCoverage,
} = await import("../lib/openclaw");

describe("openclaw catalog helpers", () => {
  it("builds catalog with unified model ids and inferred metadata", async () => {
    const catalog = await buildOpenClawCatalog();

    expect(catalog).toHaveLength(2);
    expect(catalog[0]?.unifiedModelId).toContain("/");
    expect(catalog.some((model) => model.pricingTier === "free")).toBe(true);
  });

  it("computes preset recommendations", async () => {
    const catalog = await buildOpenClawCatalog();
    const presets = buildOpenClawPresetRecommendations(catalog);

    expect(presets).toHaveLength(4);
    expect(presets.map((item) => item.preset)).toEqual(
      expect.arrayContaining(["coding", "agentic", "low-cost", "long-context"]),
    );
  });

  it("summarizes provider coverage", async () => {
    const catalog = await buildOpenClawCatalog();
    const summary = summarizeProviderCoverage(catalog);

    expect(summary.totalModels).toBe(2);
    expect(summary.modelsByProvider).toEqual({
      groq: 1,
      openrouter: 1,
    });
  });
});
