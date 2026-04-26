import {
  createProviderApp,
  fetchWithTimeout,
  resolveEnv,
  type ProviderModel,
} from '../lib/provider-core'
import { chatViaOpenAiCompatible } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: true, tools: true }, id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Google AI Studio)' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite (Google AI Studio)' },
]

const app = createProviderApp({
  providerId: 'googleaistudio',
  basePath: '/googleaistudio',
  models,
  defaultModel: models[0].id,
  fetchModels: fetchGoogleAiStudioModels,
  testCredentials: async (credentials) => {
    try {
      const apiKey = resolveEnv('GOOGLE_AI_STUDIO_API_KEY', credentials)
      const base = process.env.GOOGLE_AI_STUDIO_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
      const url = `${base}/models?key=${encodeURIComponent(apiKey)}`
      const response = await fetchWithTimeout(url, { method: 'GET' }, 15000)
      if (response.ok) return { ok: true }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: `Chave inválida ou sem permissão (${response.status}).` }
      }
      const errorText = await response.text().catch(() => '')
      return { ok: false, error: `Erro ${response.status}: ${errorText.slice(0, 200)}` }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
        return { ok: false, error: 'Credencial não fornecida.' }
      }
      return { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido.' }
    }
  },
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'Google AI Studio',
        chatUrl:
          process.env.GOOGLE_AI_STUDIO_OPENAI_CHAT_URL ||
          'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        apiKeyEnv: 'GOOGLE_AI_STUDIO_API_KEY',
      },
      { messages, modelId, rawBody },
      credentials,
    ),
})

export async function fetchGoogleAiStudioModels(credentials?: Record<string, string>): Promise<ProviderModel[]> {
  const apiKey = resolveEnv('GOOGLE_AI_STUDIO_API_KEY', credentials)
  const base = process.env.GOOGLE_AI_STUDIO_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
  const url = `${base}/models?key=${encodeURIComponent(apiKey)}`
  const response = await fetchWithTimeout(url, { method: 'GET' }, 15000)
  if (!response.ok) throw new Error(`Google AI Studio models API returned ${response.status}`)

  const json = (await response.json()) as {
    models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>
  }
  if (!json.models?.length) throw new Error('Empty models response from Google AI Studio')

  // Filter only models that support generateContent (chat-capable)
  const chatModels = json.models.filter((m) =>
    m.supportedGenerationMethods?.includes('generateContent'),
  )

  return chatModels.map((m) => {
    // name comes as "models/gemini-2.5-flash", strip the prefix
    const id = m.name.replace(/^models\//, '')
    return {
      capabilities: { documents: true, images: true, tools: true },
      id,
      name: `${m.displayName || id} (Google AI Studio)`,
    }
  })
}

export default app.fetch
