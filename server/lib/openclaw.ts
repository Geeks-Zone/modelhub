import type { ProviderModel } from "./provider-core";

import { isProviderEnabled } from "./catalog";
import {
  resolveContextWindow,
  resolveLatencyTier,
  resolvePricingTier,
  resolveReasoning,
} from "./openclaw-model-metadata";
import { getProviderModels, providerRegistry } from "../providers/registry";

const OPENCLAW_CATALOG_CACHE_MAX_ENTRIES = 256;
const OPENCLAW_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const OPENCLAW_CATALOG_CACHE_ABSOLUTE_TTL_MS = 30 * 60 * 1000;

type CatalogCacheEntry = {
  catalog: OpenClawCatalogModel[];
  createdAt: number;
  fetchedAt: number;
};

const catalogCache = new Map<string, CatalogCacheEntry>();

type BuildOpenClawCatalogOptions = {
  cacheKeySuffix?: string;
  providerCredentials?: Record<string, Record<string, string>>;
  providerIds?: Iterable<string>;
};

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

// Decisoes de contextWindow / pricing / latency / reasoning sao delegadas ao
// modulo openclaw-model-metadata.ts (tabela explicita + heuristica honesta).

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  cerebras: "Cerebras",
  cloudflareworkersai: "Cloudflare Workers AI",
  codestral: "Codestral",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  duckai: "Duck.ai",
  fireworks: "Fireworks",
  gateway: "Gateway",
  githubmodels: "GitHub Models",
  googleaistudio: "Google AI Studio",
  groq: "Groq",
  huggingface: "HuggingFace",
  mistral: "Mistral",
  nvidianim: "NVIDIA NIM",
  opencodezen: "OpenCode Zen",
  openrouter: "OpenRouter",
  perplexity: "Perplexity",
  pollinations: "Pollinations",
  quillbot: "Quillbot",
  togetherai: "Together AI",
  vercelgateway: "Vercel AI Gateway",
};

function providerDisplayName(providerId: string): string {
  return PROVIDER_DISPLAY_NAMES[providerId] ?? providerId;
}

function cleanModelName(modelName: string, providerId: string): string {
  const displayName = providerDisplayName(providerId);
  const suffix = ` (${displayName})`;
  if (modelName.endsWith(suffix)) {
    return modelName.slice(0, -suffix.length);
  }
  const parenIdx = modelName.indexOf(" (");
  if (parenIdx > 0) {
    return modelName.slice(0, parenIdx);
  }
  return modelName;
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
  const contextWindow = resolveContextWindow(providerId, model.id);
  const pricingTier = resolvePricingTier(providerId, model.id);
  const latencyTier = resolveLatencyTier(providerId, model.id);
  const reasoning = resolveReasoning(providerId, model.id);
  const tools = model.capabilities.tools ?? false;
  const displayName = providerDisplayName(providerId);
  const modelName = cleanModelName(model.name, providerId);
  const fullName = `${displayName}: ${modelName}`;

  const out: OpenClawCatalogModel = {
    alias: deriveAlias(fullName),
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
    name: fullName,
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

function getEnabledProviderIds(providerIds?: Iterable<string>): string[] {
  const candidates = providerIds ? [...providerIds] : Object.keys(providerRegistry);
  return [...new Set(candidates.map((providerId) => providerId.trim()).filter(Boolean))]
    .filter((providerId) => providerRegistry[providerId] && isProviderEnabled(providerId))
    .sort();
}

function buildCatalogCacheKey(providerIds: string[], cacheKeySuffix: string | undefined): string {
  return `${cacheKeySuffix?.trim() || "env"}:${providerIds.join(",")}`;
}

function pruneExpiredCatalogCacheEntries(now: number): void {
  for (const [key, entry] of catalogCache) {
    if (now - entry.createdAt >= OPENCLAW_CATALOG_CACHE_ABSOLUTE_TTL_MS) {
      catalogCache.delete(key);
    }
  }
}

function getCachedCatalog(cacheKey: string, now: number): OpenClawCatalogModel[] | null {
  const cached = catalogCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (
    now - cached.fetchedAt >= OPENCLAW_CATALOG_CACHE_TTL_MS ||
    now - cached.createdAt >= OPENCLAW_CATALOG_CACHE_ABSOLUTE_TTL_MS
  ) {
    catalogCache.delete(cacheKey);
    return null;
  }

  catalogCache.delete(cacheKey);
  catalogCache.set(cacheKey, cached);
  return cached.catalog;
}

function setCachedCatalog(cacheKey: string, catalog: OpenClawCatalogModel[], now: number): void {
  pruneExpiredCatalogCacheEntries(now);
  catalogCache.delete(cacheKey);

  while (catalogCache.size >= OPENCLAW_CATALOG_CACHE_MAX_ENTRIES) {
    const oldestKey = catalogCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    catalogCache.delete(oldestKey);
  }

  catalogCache.set(cacheKey, { catalog, createdAt: now, fetchedAt: now });
}

export function getOpenClawCatalogCacheStats(): {
  maxEntries: number;
  size: number;
} {
  return {
    maxEntries: OPENCLAW_CATALOG_CACHE_MAX_ENTRIES,
    size: catalogCache.size,
  };
}

export function clearOpenClawCatalogCache(): void {
  catalogCache.clear();
}

export async function buildOpenClawCatalog(
  options: BuildOpenClawCatalogOptions = {},
): Promise<OpenClawCatalogModel[]> {
  const enabledProviders = getEnabledProviderIds(options.providerIds);
  const cacheKey = buildCatalogCacheKey(enabledProviders, options.cacheKeySuffix);
  const now = Date.now();
  const cached = getCachedCatalog(cacheKey, now);
  if (cached) {
    return cached;
  }

  const results = await Promise.allSettled(
    enabledProviders.map(async (providerId) => {
      const models = await getProviderModels(providerId, {
        cacheKeySuffix: options.cacheKeySuffix ? `openclaw:${options.cacheKeySuffix}` : undefined,
        credentials: options.providerCredentials?.[providerId],
        staleWhileRevalidate: false,
      });
      return { models, providerId };
    }),
  );

  const catalog: OpenClawCatalogModel[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const model of result.value.models) {
      const entry = toOpenClawCatalogModel(result.value.providerId, model);
      if (!entry.capabilities.tools) continue;
      catalog.push(entry);
    }
  }

  const sorted = catalog.sort((a, b) => {
    const providerCmp = a.providerId.localeCompare(b.providerId);
    if (providerCmp !== 0) return providerCmp;
    return a.modelId.localeCompare(b.modelId);
  });
  setCachedCatalog(cacheKey, sorted, now);
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

/**
 * Minimum context window (in tokens) a model must declare to stay in the OpenClaw
 * fallback chain. OpenClaw prepends a large system prompt describing the tool
 * inventory (~20-30k tokens in practice). Falling back to a small-context model
 * (e.g. Cerebras gpt-oss-120b at 8192) would immediately overflow and surface a
 * confusing "reduce the length of the messages" upstream error instead of a real
 * retry, so we prune those from the fallback list.
 */
const OPENCLAW_MIN_FALLBACK_CONTEXT = 32 * 1024;

export function buildOpenClawConfig(
  catalog: OpenClawCatalogModel[],
  presets: OpenClawPresetRecommendation[],
  baseUrl: string,
): OpenClawConfigOutput {
  const modelsList = catalog.map((m) => {
    return {
      contextWindow: m.contextWindow ?? undefined,
      id: m.unifiedModelId,
      input: inferModelInput(m),
      maxTokens: m.maxTokens ?? undefined,
      name: m.name,
      reasoning: m.capabilities.reasoning !== "none",
    };
  });

  const primaryPreset = presets.find((p) => p.preset === "coding");
  const primary = primaryPreset?.model ?? (catalog.length > 0 ? catalog[0].unifiedModelId : "modelhub/openai/gpt-4.1-mini");

  const catalogByUnifiedId = new Map(catalog.map((m) => [m.unifiedModelId, m] as const));
  const isFallbackCompatible = (modelRef: string): boolean => {
    const entry = catalogByUnifiedId.get(modelRef);
    if (!entry) return true; // unknown models pass through; we only prune what we can prove is too small
    if (entry.contextWindow === null || entry.contextWindow === undefined) return true;
    return entry.contextWindow >= OPENCLAW_MIN_FALLBACK_CONTEXT;
  };

  const fallbacks: string[] = [];
  for (const preset of presets) {
    if (preset.model && preset.model !== primary && !fallbacks.includes(preset.model) && isFallbackCompatible(preset.model)) {
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
