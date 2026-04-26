import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'accounts/fireworks/models/llama4-scout-instruct-basic', name: 'Llama 4 Scout (Fireworks)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B (Fireworks)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'accounts/fireworks/models/deepseek-r1', name: 'DeepSeek R1 (Fireworks)' },
]

const FIREWORKS_CHAT_URL = process.env.FIREWORKS_CHAT_URL || 'https://api.fireworks.ai/inference/v1/chat/completions'
const FIREWORKS_MODELS_URL = 'https://api.fireworks.ai/inference/v1/models'
const FIREWORKS_API_KEY = 'FIREWORKS_API_KEY'

const app = createProviderApp({
  providerId: 'fireworks',
  basePath: '/fireworks',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Fireworks AI', chatUrl: FIREWORKS_CHAT_URL, apiKeyEnv: FIREWORKS_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({ modelsUrl: FIREWORKS_MODELS_URL, apiKeyEnv: FIREWORKS_API_KEY, providerName: 'Fireworks AI' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: FIREWORKS_MODELS_URL, apiKeyEnv: FIREWORKS_API_KEY, providerName: 'Fireworks AI' }, credentials),
})

export default app.fetch