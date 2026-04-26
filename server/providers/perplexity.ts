import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false, tools: true }, id: 'sonar', name: 'Sonar' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'sonar-pro', name: 'Sonar Pro' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'sonar-reasoning', name: 'Sonar Reasoning' },
]

const PERPLEXITY_CHAT_URL = process.env.PERPLEXITY_CHAT_URL || 'https://api.perplexity.ai/chat/completions'
const PERPLEXITY_MODELS_URL = 'https://api.perplexity.ai/models'
const PERPLEXITY_API_KEY = 'PERPLEXITY_API_KEY'

const app = createProviderApp({
  providerId: 'perplexity',
  basePath: '/perplexity',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      { providerName: 'Perplexity', chatUrl: PERPLEXITY_CHAT_URL, apiKeyEnv: PERPLEXITY_API_KEY },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({ modelsUrl: PERPLEXITY_MODELS_URL, apiKeyEnv: PERPLEXITY_API_KEY, providerName: 'Perplexity' }),
  testCredentials: (credentials) =>
    testViaOpenAiModels({ modelsUrl: PERPLEXITY_MODELS_URL, apiKeyEnv: PERPLEXITY_API_KEY, providerName: 'Perplexity' }, credentials),
})

export default app.fetch