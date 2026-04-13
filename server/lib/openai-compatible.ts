import {
  fetchWithTimeout,
  internalProviderErrorResponse,
  postJsonWithTimeout,
  resolveEnv,
  toVercelSingleTextResponse,
  toVercelStreamFromOpenAiSse,
  toVercelToolCallsResponse,
  upstreamErrorResponse,
} from './provider-core'
import type { ChatMessage, ProviderModel } from './provider-core'

function hasImageCapability(model: Record<string, unknown>): boolean {
  const candidates = [
    model.input_modalities,
    model.modalities,
    typeof model.architecture === 'object' && model.architecture !== null
      ? (model.architecture as Record<string, unknown>).input_modalities
      : undefined,
    typeof model.capabilities === 'object' && model.capabilities !== null
      ? (model.capabilities as Record<string, unknown>).input_modalities
      : undefined,
  ]

  return candidates.some((candidate) =>
    Array.isArray(candidate) &&
    candidate.some((value) => typeof value === 'string' && value.toLowerCase() === 'image'),
  )
}

type OpenAiCompatibleConfig = {
  providerName: string
  chatUrl: string
  apiKeyEnv: string
  extraHeaders?: Record<string, string>
  bodyTransform?: (input: { messages: ChatMessage[]; modelId: string; rawBody: Record<string, unknown> }) => Record<string, unknown>
  timeoutMs?: number
}

/**
 * Default system prompt injected when the conversation has no system message.
 * Instructs models to use proper markdown formatting — especially fenced code
 * blocks — so the client-side renderer can display responses correctly.
 */
const DEFAULT_SYSTEM_PROMPT = [
  'Format all responses using proper Markdown.',
  'For code, ALWAYS use fenced code blocks with the language identifier (e.g. ```python).',
  'Never collapse multiple lines of code onto a single line.',
  'Separate code blocks from surrounding text with blank lines.',
].join(' ')

/** OpenAI-compatible fields that should be forwarded when present in rawBody. */
const PASSTHROUGH_FIELDS = [
  'tools',
  'tool_choice',
  'response_format',
  'temperature',
  'max_tokens',
  'top_p',
  'stop',
  'frequency_penalty',
  'presence_penalty',
  'seed',
  'n',
  'logprobs',
  'top_logprobs',
  'user',
] as const

/** Convert ChatMessage[] to OpenAI-compatible message format. */
function toOpenAiMessages(
  messages: ChatMessage[],
): Record<string, unknown>[] {
  return messages.map((msg) => {
    const out: Record<string, unknown> = { role: msg.role }

    if (typeof msg.content === 'string') {
      out.content = msg.content
    } else if (Array.isArray(msg.content)) {
      out.content = msg.content.map((part) => {
        if (part.type === 'text') return { type: 'text', text: part.text }
        if (part.type === 'image_url') return { type: 'image_url', image_url: part.image_url }
        return part
      })
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) out.tool_calls = msg.tool_calls
    if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id
    if (msg.name) out.name = msg.name

    return out
  })
}

function buildDefaultBody(
  input: { messages: ChatMessage[]; modelId: string; rawBody: Record<string, unknown> },
): Record<string, unknown> {
  const openAiMessages = toOpenAiMessages(input.messages)

  // Inject a system prompt if the conversation doesn't already have one,
  // so that models produce well-formatted markdown (especially code blocks).
  const hasSystemMessage = openAiMessages.some((m) => m.role === 'system')
  if (!hasSystemMessage) {
    openAiMessages.unshift({ role: 'system', content: DEFAULT_SYSTEM_PROMPT })
  }

  const body: Record<string, unknown> = {
    model: input.modelId,
    messages: openAiMessages,
    stream: true,
  }

  for (const field of PASSTHROUGH_FIELDS) {
    if (input.rawBody[field] !== undefined) {
      body[field] = input.rawBody[field]
    }
  }

  return body
}

type OpenAiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OpenAiNonStreamingResponse = {
  choices?: Array<{
    message?: {
      content?: string
      tool_calls?: OpenAiToolCall[]
    }
  }>
  output_text?: string
  response?: string
} | null

export async function chatViaOpenAiCompatible(
  config: OpenAiCompatibleConfig,
  input: { messages: ChatMessage[]; modelId: string; rawBody: Record<string, unknown> },
  credentials?: Record<string, string>,
): Promise<Response> {
  try {
    const apiKey = resolveEnv(config.apiKeyEnv, credentials)

    const body = config.bodyTransform
      ? config.bodyTransform(input)
      : buildDefaultBody(input)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    }

    if (config.extraHeaders) {
      Object.assign(headers, config.extraHeaders)
    }

    const response = await postJsonWithTimeout(config.chatUrl, {
      headers,
      body,
      timeoutMs: config.timeoutMs ?? 60000,
    })

    if (!response.ok) {
      const errorText = await response.text()
      const guidance = getUpstreamErrorGuidance(config.providerName, response.status, errorText)
      if (guidance) {
        console.error(`[${config.providerName}] upstream error ${response.status}: ${errorText.slice(0, 500)}`)
        return toVercelSingleTextResponse(guidance)
      }
      return upstreamErrorResponse(config.providerName, response.status, errorText)
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream')) {
      return toVercelStreamFromOpenAiSse(response)
    }

    const json = (await response.json().catch(() => null)) as OpenAiNonStreamingResponse
    const message = json?.choices?.[0]?.message

    // Handle tool_calls in non-streaming response
    if (message?.tool_calls && message.tool_calls.length > 0) {
      return toVercelToolCallsResponse(message.tool_calls, message.content || undefined)
    }

    const directText = message?.content || json?.output_text || json?.response || ''
    return toVercelSingleTextResponse(String(directText))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
      throw error
    }

    return internalProviderErrorResponse(config.providerName, error)
  }
}

/**
 * Test credentials by hitting the /models endpoint of an OpenAI-compatible provider.
 * Returns { ok: true } if the key is valid, or { ok: false, error } otherwise.
 */
export async function testViaOpenAiModels(
  opts: {
    modelsUrl: string
    apiKeyEnv: string
    providerName: string
    extraHeaders?: Record<string, string>
  },
  credentials: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiKey = resolveEnv(opts.apiKeyEnv, credentials)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    }
    if (opts.extraHeaders) {
      Object.assign(headers, opts.extraHeaders)
    }

    const response = await fetchWithTimeout(
      opts.modelsUrl,
      { method: 'GET', headers },
      15000,
    )

    if (response.ok) {
      return { ok: true }
    }

    const errorText = await response.text().catch(() => '')
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Chave inválida ou sem permissão (${response.status}).` }
    }
    return { ok: false, error: `Erro ${response.status}: ${errorText.slice(0, 200)}` }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
      return { ok: false, error: 'Credencial não fornecida.' }
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido.' }
  }
}

/**
 * Fetch models from an OpenAI-compatible /v1/models endpoint.
 * Returns a list of ProviderModel objects with id and name.
 * Requires a valid API key to be configured.
 */
export function createOpenAiFetchModels(opts: {
  modelsUrl: string
  apiKeyEnv: string
  providerName: string
  extraHeaders?: Record<string, string>
  /** Optional filter to select which models to include. Defaults to all. */
  filter?: (model: { id: string; owned_by?: string }) => boolean
}): (credentials?: Record<string, string>) => Promise<ProviderModel[]> {
  return async (credentials?: Record<string, string>) => {
    const apiKey = resolveEnv(opts.apiKeyEnv, credentials)

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
    if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders)

    const response = await fetchWithTimeout(opts.modelsUrl, { method: 'GET', headers }, 15000)
    if (!response.ok) throw new Error(`${opts.providerName} models API returned ${response.status}`)

    const json = (await response.json()) as {
      data?: Array<Record<string, unknown> & { id: string; owned_by?: string }>
    }

    if (!json.data?.length) throw new Error(`Empty models response from ${opts.providerName}`)

    const filtered = opts.filter ? json.data.filter(opts.filter) : json.data

    return filtered.map((m) => ({
      capabilities: {
        documents: true,
        images: hasImageCapability(m),
      },
      id: m.id,
      name: `${m.id} (${opts.providerName})`,
    }))
  }
}

/**
 * Return a user-facing guidance message for known upstream errors,
 * or null if the error is not recognized and should use the default handler.
 */
function getUpstreamErrorGuidance(
  providerName: string,
  status: number,
  errorText: string,
): string | null {
  // --- OpenRouter specific ---
  if (providerName === 'OpenRouter') {
    // Guardrail restrictions
    if (status === 404 && errorText.includes('No endpoints available')) {
      return [
        '⚠️ **Erro de configuração no OpenRouter**\n',
        'Seus guardrails de privacidade estão bloqueando este modelo.\n',
        '**Para resolver:**',
        '1. Acesse https://openrouter.ai/workspaces/default/guardrails',
        '2. Desative **"ZDR Endpoints Only"**',
        '3. Ative os toggles: *Enable paid endpoints*, *Enable free endpoints that may train on inputs*, *Enable free endpoints that may publish prompts*',
        '4. Em "Provider Restrictions", deixe *Ignored Providers* e *Allowed Providers* vazios',
        '5. Confirme no **Eligibility Preview** que mostra **0 unavailable**',
      ].join('\n')
    }

    // Rate limit with model name
    if (status === 429) {
      const modelMatch = /([\w/.:]+) is temporarily rate-limited/.exec(errorText)
      const modelName = modelMatch?.[1] ?? 'Este modelo'
      return [
        `⏳ **${modelName}** atingiu o limite de requisições temporariamente.\n`,
        '**O que fazer:**',
        '- Aguarde alguns segundos e tente novamente',
        '- Modelos gratuitos (`:free`) têm limites mais baixos',
        '- Para limites maiores, adicione sua própria API key em https://openrouter.ai/settings/integrations',
      ].join('\n')
    }
  }

  // --- Generic rate limit for any provider ---
  if (status === 429) {
    return `⏳ **${providerName}** atingiu o limite de requisições. Aguarde alguns segundos e tente novamente.`
  }

  return null
}
