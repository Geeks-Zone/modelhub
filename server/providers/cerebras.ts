import { createProviderApp } from '../lib/provider-core'
import {
  buildOpenAiCompatibleChatBody,
  chatViaOpenAiCompatible,
  createOpenAiFetchModels,
  testViaOpenAiModels,
} from '../lib/openai-compatible'

/** Ordem de preferência só entre modelos que a API listar para a sua chave (menos “chute” que uma lista fixa). */
const CEREBRAS_FALLBACK_PRIORITY: readonly string[] = [
  'llama3.1-8b',
  'qwen-3-235b-a22b-instruct-2507',
  'gpt-oss-120b',
  'zai-glm-4.7',
]

const fetchCerebrasModels = createOpenAiFetchModels({
  modelsUrl: 'https://api.cerebras.ai/v1/models',
  apiKeyEnv: 'CEREBRAS_API_KEY',
  providerName: 'Cerebras',
})

function parseEnvCerebrasFallbackIds(): string[] | null {
  const raw = process.env.CEREBRAS_FALLBACK_MODEL_IDS?.trim()
  if (!raw) {
    return null
  }
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return ids.length > 0 ? ids : null
}

function orderFallbackIds(requestedId: string, availableIds: string[]): string[] {
  const set = new Set(availableIds)
  const out: string[] = []
  for (const id of CEREBRAS_FALLBACK_PRIORITY) {
    if (id !== requestedId && set.has(id) && !out.includes(id)) {
      out.push(id)
    }
  }
  for (const id of availableIds) {
    if (id !== requestedId && !out.includes(id)) {
      out.push(id)
    }
  }
  return out
}

async function resolveCerebrasFallbackIds(
  requestedId: string,
  credentials: Record<string, string> | undefined,
): Promise<string[]> {
  const envIds = parseEnvCerebrasFallbackIds()
  if (envIds) {
    return envIds.filter((id) => id !== requestedId)
  }

  try {
    const list = await fetchCerebrasModels(credentials)
    return orderFallbackIds(
      requestedId,
      list.map((m) => m.id),
    )
  } catch (error) {
    console.warn(
      '[cerebras] não foi possível usar GET /v1/models para montar a cadeia de fallback; usando prioridade mínima',
      error,
    )
    return CEREBRAS_FALLBACK_PRIORITY.filter((id) => id !== requestedId)
  }
}

/** Só modelos seguros quando GET /v1/models falha — evita exibir IDs que a chave não pode usar no chat. */
export const models = [
  { capabilities: { documents: true, images: false, tools: false }, id: 'llama3.1-8b', name: 'Llama 3.1 8B (Cerebras)' },
]

const app = createProviderApp({
  providerId: 'cerebras',
  basePath: '/cerebras',
  models,
  defaultModel: models[0].id,
  modelsCacheTtlMs: 3 * 60 * 1000,
  chat: async (messages, modelId, rawBody, credentials) => {
    const fallbackModelIds = await resolveCerebrasFallbackIds(modelId, credentials)
    return chatViaOpenAiCompatible(
      {
        providerName: 'Cerebras',
        chatUrl: process.env.CEREBRAS_CHAT_URL || 'https://api.cerebras.ai/v1/chat/completions',
        apiKeyEnv: 'CEREBRAS_API_KEY',
        fallbackModelIds,
        bodyTransform: (input) => {
          const body = buildOpenAiCompatibleChatBody(input)
          if (input.modelId === 'zai-glm-4.7' && body.reasoning_effort === undefined) {
            body.reasoning_effort = 'none'
          }
          return body
        },
      },
      { messages, modelId, rawBody },
      credentials,
    )
  },
  fetchModels: fetchCerebrasModels,
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://api.cerebras.ai/v1/models', apiKeyEnv: 'CEREBRAS_API_KEY', providerName: 'Cerebras' },
      credentials,
    ),
})

export default app.fetch
