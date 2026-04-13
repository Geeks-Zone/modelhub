import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false }, id: 'big-pickle-stealth', name: 'Big Pickle Stealth (OpenCode Zen)' },
  { capabilities: { documents: true, images: false }, id: 'minimax-m2.5-free', name: 'MiniMax M2.5 Free (OpenCode Zen)' },
]

const app = createProviderApp({
  providerId: 'opencodezen',
  basePath: '/opencodezen',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'OpenCode Zen',
        chatUrl:
          process.env.OPENCODE_ZEN_CHAT_URL ||
          'https://api.opencode.ai/v1/chat/completions',
        apiKeyEnv: 'OPENCODE_ZEN_API_KEY',
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://api.opencode.ai/v1/models',
    apiKeyEnv: 'OPENCODE_ZEN_API_KEY',
    providerName: 'OpenCode Zen',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://api.opencode.ai/v1/models', apiKeyEnv: 'OPENCODE_ZEN_API_KEY', providerName: 'OpenCode Zen' },
      credentials,
    ),
})

export default app.fetch

