import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false }, id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B (Together)' },
  { capabilities: { documents: true, images: false }, id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B (Together)' },
  { capabilities: { documents: true, images: true }, id: 'meta-llama/Llama-Vision-Free', name: 'Llama Vision Free (Together)' },
]

const TOGETHER_CHAT_URL = process.env.TOGETHER_CHAT_URL || 'https://api.together.xyz/v1/chat/completions'
const TOGETHER_MODELS_URL = 'https://api.together.xyz/v1/models'
const TOGETHER_API_KEY = 'TOGETHER_API_KEY'

const app = createProviderApp({
  providerId: 'togetherai',
  basePath: '/togetherai',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Together AI', chatUrl: TOGETHER_CHAT_URL, apiKeyEnv: TOGETHER_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({ modelsUrl: TOGETHER_MODELS_URL, apiKeyEnv: TOGETHER_API_KEY, providerName: 'Together AI' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: TOGETHER_MODELS_URL, apiKeyEnv: TOGETHER_API_KEY, providerName: 'Together AI' }, credentials),
})

export default app.fetch