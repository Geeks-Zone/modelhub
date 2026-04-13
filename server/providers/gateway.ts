import {
  createProviderApp,
  fetchWithTimeout,
  internalProviderErrorResponse,
  type ChatMessage,
  type ProviderModel,
} from '../lib/provider-core'

const GATEWAY_BASE = 'https://ai-sdk-gateway-demo.labs.vercel.dev'

export const GATEWAY_MODELS: ProviderModel[] = [
  { capabilities: { documents: true, images: false }, id: 'amazon/nova-lite', name: 'Nova Lite' },
  { capabilities: { documents: true, images: false }, id: 'amazon/nova-micro', name: 'Nova Micro' },
  { capabilities: { documents: true, images: true }, id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { capabilities: { documents: true, images: true }, id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
  { capabilities: { documents: true, images: false }, id: 'meta/llama-3.1-8b', name: 'Llama 3.1 8B Instruct' },
  { capabilities: { documents: true, images: true }, id: 'openai/gpt-5-mini', name: 'GPT-5 mini' },
  { capabilities: { documents: true, images: false }, id: 'openai/gpt-5-nano', name: 'GPT-5 nano' },
]

export async function fetchGatewayModels(): Promise<ProviderModel[]> {
  try {
    const response = await fetchWithTimeout(`${GATEWAY_BASE}/api/models`, { method: 'GET' }, 10000)
    if (!response.ok) return GATEWAY_MODELS

    const data = (await response.json()) as {
      models?: Array<{ capabilities?: { documents?: boolean; images?: boolean }; id: string; name: string }>
    }
    if (!data.models?.length) return GATEWAY_MODELS

    return data.models.map((m) => ({
      capabilities: {
        documents: m.capabilities?.documents ?? true,
        images: m.capabilities?.images ?? false,
      },
      id: m.id,
      name: m.name,
    }))
  } catch {
    return GATEWAY_MODELS
  }
}

const app = createProviderApp({
  providerId: 'gateway',
  basePath: '/gateway',
  models: GATEWAY_MODELS,
  defaultModel: GATEWAY_MODELS[0].id,
  fetchModels: fetchGatewayModels,
  chat: async (messages: ChatMessage[], modelId: string, rawBody: Record<string, unknown>) => {
    try {
      const response = await fetchWithTimeout(
        `${GATEWAY_BASE}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...rawBody, messages, modelId }),
        },
        60000,
      )

      // Pass through the response directly — gateway returns Vercel AI SDK format
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (error) {
      return internalProviderErrorResponse('Gateway', error)
    }
  },
})

export default app.fetch
