import type { ProviderModel } from "./provider-core";

import { isProviderEnabled } from "./catalog";
import { getProviderModels, providerRegistry } from "../providers/registry";

const OPENCLAW_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type CatalogCacheEntry = {
  catalog: OpenClawCatalogModel[];
  fetchedAt: number;
};

let catalogCache: CatalogCacheEntry | null = null;

export type OpenClawPresetId = "coding" | "agentic" | "low-cost" | "long-context";

export type OpenClawCatalogModel = {
  alias?: string;
  capabilities: {
    documents: boolean;
    images: boolean;
    reasoning: "none" | "basic" | "advanced";
    tools: boolean;
  };
  contextWindow: number | null;
  id: string;
  latencyTier: "low" | "medium" | "high" | "unknown";
  maxTokens: number | null;
  modelId: string;
  name: string;
  presets: OpenClawPresetId[];
  pricingTier: "free" | "low" | "standard" | "premium" | "unknown";
  providerId: string;
  unifiedModelId: string;
};

export type OpenClawPresetRecommendation = {
  model: string | null;
  preset: OpenClawPresetId;
  reason: string;
};

function inferContextWindow(modelId: string): number | null {
  const directKMatch = /(^|[^0-9])(\d{2,4})k([^0-9]|$)/i.exec(modelId);
  if (!directKMatch) return null;

  const asNumber = Number(directKMatch[2]);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
  return asNumber * 1024;
}

function inferPricingTier(modelId: string): OpenClawCatalogModel["pricingTier"] {
  const id = modelId.toLowerCase();
  if (id.includes(":free") || id.includes("/free")) return "free";
  if (id.includes("mini") || id.includes("nano") || id.includes("flash-lite")) return "low";
  if (id.includes("opus") || id.includes("ultra") || id.includes("gpt-5")) return "premium";
  if (id.includes("gpt-4") || id.includes("sonnet") || id.includes("r1")) return "standard";
  return "unknown";
}

function inferLatencyTier(modelId: string): OpenClawCatalogModel["latencyTier"] {
  const id = modelId.toLowerCase();
  if (id.includes("flash") || id.includes("instant") || id.includes("haiku") || id.includes("mini")) return "low";
  if (id.includes("opus") || id.includes("70b") || id.includes("405b")) return "high";
  if (id.includes("sonnet") || id.includes("pro") || id.includes("plus")) return "medium";
  return "unknown";
}

function inferReasoning(modelId: string): OpenClawCatalogModel["capabilities"]["reasoning"] {
  const id = modelId.toLowerCase();
  if (id.includes("reason") || id.includes("r1") || id.includes("o1") || id.includes("o3") || id.includes("think")) {
    return "advanced";
  }
  if (id.includes("instruct") || id.includes("chat")) return "basic";
  return "none";
}

function inferToolsCapability(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes("vision-only")) return false;
  return true;
}

function inferPresets(model: OpenClawCatalogModel): OpenClawPresetId[] {
  const result = new Set<OpenClawPresetId>();
  const id = model.modelId.toLowerCase();

  if (model.pricingTier === "free" || model.pricingTier === "low") {
    result.add("low-cost");
  }

  if ((model.contextWindow ?? 0) >= 64 * 1024 || id.includes("long") || id.includes("128k") || id.includes("200k")) {
    result.add("long-context");
  }

  if (
    model.capabilities.reasoning !== "none" ||
    id.includes("code") ||
    id.includes("coder") ||
    id.includes("gpt") ||
    id.includes("qwen")
  ) {
    result.add("coding");
  }

  if (model.capabilities.tools || model.capabilities.reasoning === "advanced") {
    result.add("agentic");
  }

  return [...result];
}

function deriveAlias(modelName: string): string {
  const name = modelName.trim();
  if (!name) return name;
  const parenIdx = name.indexOf("(");
  const clean = parenIdx > 0 ? name.slice(0, parenIdx).trim() : name;
  return clean.length <= 32 ? clean : clean.slice(0, 29) + "...";
}

function toOpenClawCatalogModel(providerId: string, model: ProviderModel): OpenClawCatalogModel {
  const contextWindow = inferContextWindow(model.id);
  const pricingTier = inferPricingTier(model.id);
  const latencyTier = inferLatencyTier(model.id);
  const reasoning = inferReasoning(model.id);
  const tools = inferToolsCapability(model.id);

  const out: OpenClawCatalogModel = {
    alias: deriveAlias(model.name),
    capabilities: {
      documents: model.capabilities.documents,
      images: model.capabilities.images,
      reasoning,
      tools,
    },
    contextWindow,
    id: model.id,
    latencyTier,
    maxTokens: null,
    modelId: model.id,
    name: model.name,
    pricingTier,
    providerId,
    presets: [],
    unifiedModelId: `${providerId}/${model.id}`,
  };
  out.presets = inferPresets(out);
  return out;
}

function scoreForPreset(model: OpenClawCatalogModel, preset: OpenClawPresetId): number {
  let score = 0;
  if (model.presets.includes(preset)) score += 20;

  if (preset === "coding") {
    if (model.capabilities.reasoning === "advanced") score += 8;
    if (model.capabilities.tools) score += 6;
    if (model.pricingTier === "premium" || model.pricingTier === "standard") score += 4;
  } else if (preset === "agentic") {
    if (model.capabilities.tools) score += 10;
    if (model.capabilities.reasoning === "advanced") score += 8;
    if (model.contextWindow && model.contextWindow >= 64 * 1024) score += 4;
  } else if (preset === "low-cost") {
    if (model.pricingTier === "free") score += 10;
    if (model.pricingTier === "low") score += 8;
    if (model.latencyTier === "low") score += 2;
  } else if (preset === "long-context") {
    if (model.contextWindow) {
      score += Math.min(12, Math.floor(model.contextWindow / (16 * 1024)));
    }
    if (model.capabilities.tools) score += 2;
  }

  return score;
}

function recommendationReason(preset: OpenClawPresetId, model: OpenClawCatalogModel | null): string {
  if (!model) {
    return "Nenhum modelo elegível encontrado para este preset.";
  }

  if (preset === "coding") return "Melhor equilíbrio entre raciocínio, tool-use e qualidade para coding.";
  if (preset === "agentic") return "Modelo com melhor suporte para tool-use e workflows agentic.";
  if (preset === "low-cost") return "Modelo com menor custo estimado e boa latência para uso diário.";
  return "Modelo com maior janela de contexto entre os disponíveis.";
}

export async function buildOpenClawCatalog(): Promise<OpenClawCatalogModel[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.fetchedAt < OPENCLAW_CATALOG_CACHE_TTL_MS) {
    return catalogCache.catalog;
  }

  const enabledProviders = Object.keys(providerRegistry).filter(isProviderEnabled);
  const results = await Promise.allSettled(
    enabledProviders.map(async (providerId) => {
      const models = await getProviderModels(providerId);
      return { models, providerId };
    }),
  );

  const catalog: OpenClawCatalogModel[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const model of result.value.models) {
      catalog.push(toOpenClawCatalogModel(result.value.providerId, model));
    }
  }

  const sorted = catalog.sort((a, b) => a.unifiedModelId.localeCompare(b.unifiedModelId));
  catalogCache = { catalog: sorted, fetchedAt: now };
  return sorted;
}

export function buildOpenClawPresetRecommendations(catalog: OpenClawCatalogModel[]): OpenClawPresetRecommendation[] {
  const presets: OpenClawPresetId[] = ["coding", "agentic", "low-cost", "long-context"];

  return presets.map((preset) => {
    const ranked = [...catalog].sort((a, b) => scoreForPreset(b, preset) - scoreForPreset(a, preset));
    const selected = ranked[0] ?? null;
    return {
      model: selected?.unifiedModelId ?? null,
      preset,
      reason: recommendationReason(preset, selected),
    };
  });
}

export function summarizeProviderCoverage(catalog: OpenClawCatalogModel[]): {
  modelsByProvider: Record<string, number>;
  totalModels: number;
} {
  const modelsByProvider: Record<string, number> = {};
  for (const model of catalog) {
    modelsByProvider[model.providerId] = (modelsByProvider[model.providerId] ?? 0) + 1;
  }

  return {
    modelsByProvider,
    totalModels: catalog.length,
  };
}

export type OpenClawConfigOutput = {
  agents: {
    defaults: {
      model: {
        fallbacks: string[];
        primary: string;
      };
      models: Record<string, { alias: string }>;
    };
  };
  models: {
    mode: string;
    providers: Record<string, {
      api: string;
      apiKey: string;
      baseUrl: string;
      models: Array<{
        contextWindow?: number;
        id: string;
        input: string[];
        maxTokens?: number;
        name: string;
        reasoning: boolean;
      }>;
    }>;
  };
};

export function buildOpenClawConfig(
  catalog: OpenClawCatalogModel[],
  presets: OpenClawPresetRecommendation[],
  baseUrl: string,
): OpenClawConfigOutput {
  const modelsList = catalog.map((m) => ({
    contextWindow: m.contextWindow ?? undefined,
    id: m.unifiedModelId,
    input: inferModelInput(m),
    maxTokens: m.maxTokens ?? undefined,
    name: m.name,
    reasoning: m.capabilities.reasoning !== "none",
  }));

  const primaryPreset = presets.find((p) => p.preset === "coding");
  const primary = primaryPreset?.model ?? (catalog.length > 0 ? catalog[0].unifiedModelId : "modelhub/openai/gpt-4.1-mini");

  const fallbacks: string[] = [];
  for (const preset of presets) {
    if (preset.model && preset.model !== primary && !fallbacks.includes(preset.model)) {
      fallbacks.push(preset.model);
    }
  }

  const modelsRecord: Record<string, { alias: string }> = {};
  for (const m of catalog) {
    const alias = m.alias ?? deriveAlias(m.name);
    if (alias) {
      modelsRecord[m.unifiedModelId] = { alias };
    }
  }

  return {
    agents: {
      defaults: {
        model: {
          fallbacks,
          primary,
        },
        models: modelsRecord,
      },
    },
    models: {
      mode: "merge",
      providers: {
        modelhub: {
          api: "openai-completions",
          apiKey: "${MODELHUB_API_KEY}",
          baseUrl: baseUrl,
          models: modelsList,
        },
      },
    },
  };
}

function inferModelInput(m: OpenClawCatalogModel): string[] {
  const input = ["text"];
  if (m.capabilities.images) input.push("image");
  return input;
}
