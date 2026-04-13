import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false }, id: 'gpt-oss-120b', name: 'GPT OSS 120B (Cerebras)' },
  { capabilities: { documents: true, images: false }, id: 'llama3.1-8b', name: 'Llama 3.1 8B (Cerebras)' },
]

const app = createProviderApp({
  providerId: 'cerebras',
  basePath: '/cerebras',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'Cerebras',
        chatUrl: process.env.CEREBRAS_CHAT_URL || 'https://api.cerebras.ai/v1/chat/completions',
        apiKeyEnv: 'CEREBRAS_API_KEY',
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://api.cerebras.ai/v1/models',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    providerName: 'Cerebras',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://api.cerebras.ai/v1/models', apiKeyEnv: 'CEREBRAS_API_KEY', providerName: 'Cerebras' },
      credentials,
    ),
})

export default app.fetch

