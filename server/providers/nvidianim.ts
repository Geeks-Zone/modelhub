import { createProviderApp } from '../lib/provider-core'
import { chatViaOpenAiCompatible, createOpenAiFetchModels, testViaOpenAiModels } from '../lib/openai-compatible'

export const models = [
  // --- NVIDIA Nemotron ---
  { capabilities: { documents: true, images: false }, id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', name: 'Nemotron Super 49B v1.5' },
  { capabilities: { documents: true, images: false }, id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', name: 'Nemotron Ultra 253B' },
  { capabilities: { documents: true, images: false }, id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B Instruct' },
  { capabilities: { documents: true, images: false }, id: 'nvidia/nemotron-3-nano-30b-a3b', name: 'Nemotron-3 Nano 30B' },
  { capabilities: { documents: true, images: false }, id: 'nvidia/nemotron-nano-9b-v2', name: 'Nemotron Nano 9B v2' },
  { capabilities: { documents: true, images: false }, id: 'nvidia/llama-3.1-nemotron-nano-8b-v1', name: 'Nemotron Nano 8B' },
  // --- DeepSeek ---
  { capabilities: { documents: true, images: false }, id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1' },
  { capabilities: { documents: true, images: false }, id: 'deepseek-ai/deepseek-v3.2', name: 'DeepSeek V3.2' },
  { capabilities: { documents: true, images: false }, id: 'deepseek-ai/deepseek-v3.1', name: 'DeepSeek V3.1' },
  // --- Meta Llama ---
  { capabilities: { documents: true, images: false }, id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
  { capabilities: { documents: true, images: false }, id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B' },
  { capabilities: { documents: true, images: false }, id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
  { capabilities: { documents: true, images: false }, id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B' },
  // --- Mistral ---
  { capabilities: { documents: true, images: false }, id: 'mistralai/mistral-large-3-675b-instruct-2512', name: 'Mistral Large 3 675B' },
  { capabilities: { documents: true, images: false }, id: 'mistralai/devstral-2-123b-instruct-2512', name: 'Devstral 2 123B' },
  { capabilities: { documents: true, images: false }, id: 'mistralai/mistral-small-31-24b-instruct-2503', name: 'Mistral Small 31 24B' },
  // --- Moonshot / Kimi ---
  { capabilities: { documents: true, images: false }, id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5' },
  { capabilities: { documents: true, images: false }, id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2 Instruct' },
  // --- Qwen ---
  { capabilities: { documents: true, images: false }, id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B' },
  // --- Google ---
  { capabilities: { documents: true, images: false }, id: 'google/gemma-3-27b-it', name: 'Gemma 3 27B' },
  // --- OpenAI Open Source ---
  { capabilities: { documents: true, images: false }, id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
  { capabilities: { documents: true, images: false }, id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B' },
]

const app = createProviderApp({
  providerId: 'nvidianim',
  basePath: '/nvidianim',
  models,
  defaultModel: models[0].id,
  chat: async (messages, modelId, rawBody, credentials) =>
    chatViaOpenAiCompatible(
      {
        providerName: 'NVIDIA NIM',
        chatUrl:
          process.env.NVIDIA_NIM_CHAT_URL || 'https://integrate.api.nvidia.com/v1/chat/completions',
        apiKeyEnv: 'NVIDIA_NIM_API_KEY',
      },
      { messages, modelId, rawBody },
      credentials,
    ),
  fetchModels: createOpenAiFetchModels({
    modelsUrl: 'https://integrate.api.nvidia.com/v1/models',
    apiKeyEnv: 'NVIDIA_NIM_API_KEY',
    providerName: 'NVIDIA NIM',
  }),
  testCredentials: (credentials) =>
    testViaOpenAiModels(
      { modelsUrl: 'https://integrate.api.nvidia.com/v1/models', apiKeyEnv: 'NVIDIA_NIM_API_KEY', providerName: 'NVIDIA NIM' },
      credentials,
    ),
})

export default app.fetch

