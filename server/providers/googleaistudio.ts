import {
  createProviderApp,
  fetchWithTimeout,
  internalProviderErrorResponse,
  messageContentAsText,
  postJsonWithTimeout,
  resolveEnv,
  toVercelSingleTextResponse,
  upstreamErrorResponse,
  type ProviderModel,
} from '../lib/provider-core'

export const models = [
  { capabilities: { documents: true, images: true }, id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Google AI Studio)' },
  { capabilities: { documents: true, images: true }, id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite (Google AI Studio)' },
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
  chat: async (messages, modelId, _rawBody, credentials) => {
    try {
      const apiKey = resolveEnv('GOOGLE_AI_STUDIO_API_KEY', credentials)
      const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${messageContentAsText(m)}`).join('\n\n')

      const base =
        process.env.GOOGLE_AI_STUDIO_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
      const url = `${base}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`

      const response = await postJsonWithTimeout(url, {
        body: {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
        },
        timeoutMs: 60000,
      })

      if (!response.ok) {
        const errorText = await response.text()
        return upstreamErrorResponse('Google AI Studio', response.status, errorText)
      }

      const json = (await response.json().catch(() => null)) as
        | {
            candidates?: Array<{
              content?: {
                parts?: Array<{ text?: string }>
              }
            }>
          }
        | null
      const content =
        json?.candidates?.[0]?.content?.parts
          ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
          .join('') || ''

      return toVercelSingleTextResponse(String(content))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
        throw error
      }

      return internalProviderErrorResponse('Google AI Studio', error)
    }
  },
})

export async function fetchGoogleAiStudioModels(): Promise<ProviderModel[]> {
  const apiKey = resolveEnv('GOOGLE_AI_STUDIO_API_KEY')
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
      capabilities: { documents: true, images: false },
      id,
      name: `${m.displayName || id} (Google AI Studio)`,
    }
  })
}

export default app.fetch
