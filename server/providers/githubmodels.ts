import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: true, tools: true }, id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini (GitHub Models)' },
  { capabilities: { documents: true, images: false, tools: true }, id: 'meta/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (GitHub Models)' },
]

const app = createProviderApp({
  providerId: 'githubmodels',
  basePath: '/githubmodels',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'GitHub Models',
        chatUrl:
          process.env.GITHUB_MODELS_CHAT_URL ||
          'https://models.inference.ai.azure.com/chat/completions',
        apiKeyEnv: 'GITHUB_TOKEN',
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://models.inference.ai.azure.com/models',
    apiKeyEnv: 'GITHUB_TOKEN',
    providerName: 'GitHub Models',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://models.inference.ai.azure.com/models', apiKeyEnv: 'GITHUB_TOKEN', providerName: 'GitHub Models' },
      credentials,
    ),
})

export default app.fetch

