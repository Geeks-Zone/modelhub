import cerebrasFetch, { models as cerebrasModels } from "./cerebras";
import cloudflareWorkersAiFetch, { models as cloudflareworkersaiModels, fetchCloudflareModels } from "./cloudflareworkersai";
import codestralFetch, { models as codestralModels } from "./codestral";
import cohereFetch, { models as cohereModels, fetchCohereModels } from "./cohere";
import duckaiFetch, { DUCKAI_MODELS, fetchDuckAiModels } from "./duckai";
import gatewayFetch, { GATEWAY_MODELS, fetchGatewayModels } from "./gateway";
import githubModelsFetch, { models as githubmodelsModels } from "./githubmodels";
import googleAiStudioFetch, { models as googleaistudioModels, fetchGoogleAiStudioModels } from "./googleaistudio";
import groqFetch, { models as groqModels } from "./groq";
import huggingFaceFetch, { models as huggingfaceModels } from "./huggingface";
import mistralFetch, { models as mistralModels } from "./mistral";
import nvidiaNimFetch, { models as nvidianimModels } from "./nvidianim";
import openCodeZenFetch, { models as opencodezenModels } from "./opencodezen";
import openrouterFetch, { models as openrouterModels } from "./openrouter";
import quillbotFetch, { QUILLBOT_MODELS } from "./quillbot";
import vercelGatewayFetch, { models as vercelgatewayModels } from "./vercelgateway";
import { DEFAULT_MODELS_CACHE_TTL_MS, getCachedModels } from "../lib/model-cache";
import { createOpenAiFetchModels } from "../lib/openai-compatible";
import type { ProviderModel } from "../lib/provider-core";

type ProviderHandler = (req: Request) => Response | Promise<Response>;

type ProviderEntry = {
  handler: ProviderHandler;
  models: readonly ProviderModel[];
  fetchModels?: () => Promise<ProviderModel[]>;
};

export const providerRegistry: Record<string, ProviderEntry> = {
  cerebras: {
    handler: cerebrasFetch,
    models: cerebrasModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.cerebras.ai/v1/models', apiKeyEnv: 'CEREBRAS_API_KEY', providerName: 'Cerebras' }),
  },
  cloudflareworkersai: { handler: cloudflareWorkersAiFetch, models: cloudflareworkersaiModels, fetchModels: fetchCloudflareModels },
  codestral: {
    handler: codestralFetch,
    models: codestralModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://codestral.mistral.ai/v1/models', apiKeyEnv: 'CODESTRAL_API_KEY', providerName: 'Mistral Codestral' }),
  },
  cohere: { handler: cohereFetch, models: cohereModels, fetchModels: fetchCohereModels },
  duckai: { handler: duckaiFetch, models: DUCKAI_MODELS, fetchModels: fetchDuckAiModels },
  gateway: { handler: gatewayFetch, models: GATEWAY_MODELS, fetchModels: fetchGatewayModels },
  githubmodels: {
    handler: githubModelsFetch,
    models: githubmodelsModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://models.inference.ai.azure.com/models', apiKeyEnv: 'GITHUB_TOKEN', providerName: 'GitHub Models' }),
  },
  googleaistudio: { handler: googleAiStudioFetch, models: googleaistudioModels, fetchModels: fetchGoogleAiStudioModels },
  groq: {
    handler: groqFetch,
    models: groqModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.groq.com/openai/v1/models', apiKeyEnv: 'GROQ_API_KEY', providerName: 'Groq' }),
  },
  huggingface: {
    handler: huggingFaceFetch,
    models: huggingfaceModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://router.huggingface.co/v1/models', apiKeyEnv: 'HUGGINGFACE_API_KEY', providerName: 'HuggingFace' }),
  },
  mistral: {
    handler: mistralFetch,
    models: mistralModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.mistral.ai/v1/models', apiKeyEnv: 'MISTRAL_API_KEY', providerName: 'Mistral' }),
  },
  nvidianim: {
    handler: nvidiaNimFetch,
    models: nvidianimModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://integrate.api.nvidia.com/v1/models', apiKeyEnv: 'NVIDIA_NIM_API_KEY', providerName: 'NVIDIA NIM' }),
  },
  opencodezen: {
    handler: openCodeZenFetch,
    models: opencodezenModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://api.opencode.ai/v1/models', apiKeyEnv: 'OPENCODE_ZEN_API_KEY', providerName: 'OpenCode Zen' }),
  },
  openrouter: {
    handler: openrouterFetch,
    models: openrouterModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://openrouter.ai/api/v1/models', apiKeyEnv: 'OPENROUTER_API_KEY', providerName: 'OpenRouter' }),
  },
  quillbot: { handler: quillbotFetch, models: QUILLBOT_MODELS },
  vercelgateway: {
    handler: vercelGatewayFetch,
    models: vercelgatewayModels,
    fetchModels: createOpenAiFetchModels({ modelsUrl: 'https://ai-gateway.vercel.sh/v1/models', apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY', providerName: 'Vercel AI Gateway' }),
  },
};

/** Get models for a provider, using dynamic fetch + cache when available. */
export async function getProviderModels(providerId: string): Promise<readonly ProviderModel[]> {
  const entry = providerRegistry[providerId];
  if (!entry) return [];

  if (entry.fetchModels) {
    return getCachedModels(providerId, entry.fetchModels, entry.models, DEFAULT_MODELS_CACHE_TTL_MS)
  }

  return entry.models;
}
