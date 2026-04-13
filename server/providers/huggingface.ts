import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  { capabilities: { documents: true, images: false }, id: 'meta-llama/Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B (HF Inference)' },
  { capabilities: { documents: true, images: false }, id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen 2.5 7B (HF Inference)' },
]

const app = createProviderApp({
  providerId: 'huggingface',
  basePath: '/huggingface',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'HuggingFace Inference',
        chatUrl:
          process.env.HUGGINGFACE_CHAT_URL ||
          'https://router.huggingface.co/v1/chat/completions',
        apiKeyEnv: 'HUGGINGFACE_API_KEY',
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://router.huggingface.co/v1/models',
    apiKeyEnv: 'HUGGINGFACE_API_KEY',
    providerName: 'HuggingFace',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://router.huggingface.co/v1/models', apiKeyEnv: 'HUGGINGFACE_API_KEY', providerName: 'HuggingFace' },
      credentials,
    ),
})

export default app.fetch

