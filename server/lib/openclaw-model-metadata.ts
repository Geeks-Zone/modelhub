/**
 * Tabela explicita de metadados de modelo para o catalogo OpenClaw.
 *
 * Antes, varias funcoes em openclaw.ts adivinhavam contextWindow, pricing,
 * latencia e reasoning a partir de substring matching no `id` do modelo
 * (`includes("opus")`, `(\d+)k`, etc). Isso falhava silenciosamente para
 * modelos populares (gpt-4o-mini sem "k", claude-sonnet sem "gpt-4") e
 * acoplava a categorizacao a strings de marketing.
 *
 * Aqui mantemos overrides estaveis por `providerId/modelId`. Heuristicas
 * agora ficam como fallback honesto: se nao casar nada, devolvemos
 * `unknown` / `null` em vez de fingir certeza.
 */
import type { OpenClawCatalogModel } from "./openclaw";

type OpenClawCapabilities = OpenClawCatalogModel["capabilities"];
type LatencyTier = OpenClawCatalogModel["latencyTier"];
type PricingTier = OpenClawCatalogModel["pricingTier"];
type ReasoningLevel = OpenClawCapabilities["reasoning"];

export type OpenClawModelOverride = {
  contextWindow?: number;
  latencyTier?: LatencyTier;
  pricingTier?: PricingTier;
  reasoning?: ReasoningLevel;
};

/**
 * Overrides por `providerId/modelId` (case-insensitive). Mantenha curto e
 * factual — adicionar 200 modelos aqui derrota o proposito; reserve para
 * familias bem conhecidas onde a heuristica falha.
 */
export const MODEL_OVERRIDES: Record<string, OpenClawModelOverride> = {
  "openai/gpt-4o": { contextWindow: 128 * 1024, latencyTier: "medium", pricingTier: "premium" },
  "openai/gpt-4o-mini": { contextWindow: 128 * 1024, latencyTier: "low", pricingTier: "low" },
  "openai/gpt-4.1-mini": { contextWindow: 1_000_000, latencyTier: "low", pricingTier: "low" },
  "openai/o1": { contextWindow: 200 * 1024, latencyTier: "high", pricingTier: "premium", reasoning: "advanced" },
  "openai/o3-mini": { contextWindow: 200 * 1024, latencyTier: "medium", pricingTier: "standard", reasoning: "advanced" },
  "anthropic/claude-3-5-sonnet": { contextWindow: 200 * 1024, latencyTier: "medium", pricingTier: "standard" },
  "anthropic/claude-3-5-haiku": { contextWindow: 200 * 1024, latencyTier: "low", pricingTier: "low" },
  "anthropic/claude-3-opus": { contextWindow: 200 * 1024, latencyTier: "high", pricingTier: "premium" },
  "google/gemini-1.5-pro": { contextWindow: 2_000_000, latencyTier: "medium", pricingTier: "standard" },
  "google/gemini-1.5-flash": { contextWindow: 1_000_000, latencyTier: "low", pricingTier: "low" },
  "deepseek/deepseek-r1": { contextWindow: 64 * 1024, pricingTier: "standard", reasoning: "advanced" },
  "cerebras/llama3.1-8b": { contextWindow: 8192 },
  "cerebras/gpt-oss-120b": { contextWindow: 8192 },
  "cerebras/qwen-3-32b": { contextWindow: 8192 },
};

function lookup(providerId: string, modelId: string): OpenClawModelOverride | null {
  const key = `${providerId.toLowerCase()}/${modelId.toLowerCase()}`;
  return MODEL_OVERRIDES[key] ?? null;
}

/**
 * Heuristica `(\d+)k` continua disponivel como fallback. Se o nome nao
 * carrega indicacao numerica de tamanho, devolvemos `null` em vez de tentar
 * adivinhar com `includes("128k")` em strings que jamais tem isso.
 */
export function resolveContextWindow(providerId: string, modelId: string): number | null {
  const override = lookup(providerId, modelId);
  if (typeof override?.contextWindow === "number") {
    return override.contextWindow;
  }

  const directKMatch = /(^|[^0-9])(\d{2,4})k([^0-9]|$)/i.exec(modelId);
  if (!directKMatch) return null;
  const asNumber = Number(directKMatch[2]);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
  return asNumber * 1024;
}

export function resolvePricingTier(providerId: string, modelId: string): PricingTier {
  const override = lookup(providerId, modelId);
  if (override?.pricingTier) return override.pricingTier;

  const id = modelId.toLowerCase();
  if (id.includes(":free") || id.includes("/free")) return "free";
  if (id.includes("mini") || id.includes("nano") || id.includes("flash-lite")) return "low";
  if (id.includes("opus") || id.includes("ultra") || id.includes("gpt-5")) return "premium";
  if (id.includes("gpt-4") || id.includes("sonnet")) return "standard";
  return "unknown";
}

export function resolveLatencyTier(providerId: string, modelId: string): LatencyTier {
  const override = lookup(providerId, modelId);
  if (override?.latencyTier) return override.latencyTier;

  const id = modelId.toLowerCase();
  if (id.includes("flash") || id.includes("instant") || id.includes("haiku") || id.includes("mini")) return "low";
  if (id.includes("opus") || id.includes("70b") || id.includes("405b")) return "high";
  if (id.includes("sonnet") || id.includes("pro") || id.includes("plus")) return "medium";
  return "unknown";
}

export function resolveReasoning(providerId: string, modelId: string): ReasoningLevel {
  const override = lookup(providerId, modelId);
  if (override?.reasoning) return override.reasoning;

  const id = modelId.toLowerCase();
  if (id.includes("reason") || /\bo1\b/.test(id) || /\bo3\b/.test(id) || id.includes("think")) {
    return "advanced";
  }
  if (id.includes("instruct") || id.includes("chat") || id.includes("gpt") || id.includes("claude")) {
    return "basic";
  }
  return "none";
}
