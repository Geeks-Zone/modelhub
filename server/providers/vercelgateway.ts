import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: true, tools: true }, id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini (Vercel AI Gateway)' },
  { capabilities: { documents: true, images: true, tools: true }, id: 'anthropic/claude-3-5-haiku', name: 'Claude 3.5 Haiku (Vercel AI Gateway)' },
]

const app = createProviderApp({
  providerId: 'vercelgateway',
  basePath: '/vercelgateway',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'Vercel AI Gateway',
        chatUrl:
          process.env.VERCEL_AI_GATEWAY_CHAT_URL ||
          'https://ai-gateway.vercel.sh/v1/chat/completions',
        apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY',
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://ai-gateway.vercel.sh/v1/models',
    apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY',
    providerName: 'Vercel AI Gateway',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://ai-gateway.vercel.sh/v1/models', apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY', providerName: 'Vercel AI Gateway' },
      credentials,
    ),
})

export default app.fetch

