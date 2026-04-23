import type { ChatMessage } from '../lib/provider-core'
import {
  createProviderApp,
  fetchWithTimeout,
  getCookieHeaderValue,
  internalProviderErrorResponse,
  jsonErrorResponse,
  messageContentAsText,
  upstreamErrorResponse,
} from '../lib/provider-core'
import { parseQuillbotUpstreamToAiStream } from '../lib/quillbot-stream'
import { ensureDebugAccess, isProductionEnv } from '../lib/security'

export const QUILLBOT_MODELS = [{ capabilities: { documents: true, images: false }, id: 'quillbot-ai', name: 'Quillbot AI Chat' }]
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
/** Override via `QUILLBOT_WEBAPP_VERSION` if Quillbot bumps the webapp and chat starts failing. */
const WEBAPP_VERSION = process.env.QUILLBOT_WEBAPP_VERSION?.trim() || '40.148.5'
const QUILLBOT_TIMEOUT = 15000

function logQuillbotIssue(context: string, error: unknown): void {
  if (!isProductionEnv()) {
    console.warn(`[quillbot] ${context}`, error)
  }
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function getQuillbotCookies(): Promise<string> {
  const homeResponse = await fetchWithTimeout(
    'https://quillbot.com/ai-chat',
    {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    },
    QUILLBOT_TIMEOUT,
  )
  const cloudflareCookies = getCookieHeaderValue(homeResponse.headers)
  const anonId = randomHex(8)
  const deviceId = crypto.randomUUID()
  const quillbotAnonId = `${randomHex(32)}.${randomHex(32)}`

  return [
    cloudflareCookies,
    `anonID=${anonId}`,
    `qbDeviceId=${deviceId}`,
    `qb_anon_id=${quillbotAnonId}`,
    'authenticated=false',
    'premium=false',
  ]
    .filter(Boolean)
    .join('; ')
}

function chatHeaders(conversationId: string, cookies: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': UA,
    Origin: 'https://quillbot.com',
    Referer: `https://quillbot.com/ai-chat/c/${conversationId}`,
    'platform-type': 'webapp',
    'qb-product': 'AI-CHAT',
    useridtoken: 'empty-token',
    'webapp-version': WEBAPP_VERSION,
    Cookie: cookies,
  }
}

function getLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find((message) => message.role === 'user')
}

async function sendQuillbotChat(message: string): Promise<Response> {
  const cookies = await getQuillbotCookies()
  const conversationId = crypto.randomUUID()
  const chatUrl = `https://quillbot.com/api/ai-chat/chat/conversation/${conversationId}`

  return fetchWithTimeout(
    chatUrl,
    {
      method: 'POST',
      headers: chatHeaders(conversationId, cookies),
      body: JSON.stringify({
        message: { content: message, files: [] },
        context: {},
        origin: { name: 'ai-chat.chat', url: 'https://quillbot.com' },
      }),
    },
    25000,
  )
}

function buildQuillbotTextResponse(rawText: string): Response {
  const output = parseQuillbotUpstreamToAiStream(rawText, (error) =>
    logQuillbotIssue('Ignoring malformed Quillbot chunk (NDJSON/SSE).', error),
  )

  return new Response(output, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}

const app = createProviderApp({
  providerId: 'quillbot',
  basePath: '/quillbot',
  models: QUILLBOT_MODELS,
  defaultModel: QUILLBOT_MODELS[0].id,
  chat: async (messages) => {
    const lastUserMessage = getLastUserMessage(messages)
    if (!lastUserMessage) {
      return jsonErrorResponse(400, 'No user message found')
    }

    const chatResponse = await sendQuillbotChat(messageContentAsText(lastUserMessage))
    if (!chatResponse.ok) {
      const errorText = await chatResponse.text()
      return upstreamErrorResponse('Quillbot', chatResponse.status, errorText)
    }

    const rawText = await chatResponse.text()
    const head = rawText.trimStart().toLowerCase()
    if (head.startsWith('<!doctype') || head.startsWith('<html')) {
      return upstreamErrorResponse(
        'Quillbot',
        502,
        'Quillbot devolveu HTML em vez do stream esperado (bloqueio, rate limit ou alteração da API).',
      )
    }
    return buildQuillbotTextResponse(rawText)
  },
})

app.get('/debug/test', async (c) => {
  const debugError = await ensureDebugAccess(c, { providerId: 'quillbot' })
  if (debugError) {
    return debugError
  }

  try {
    const response = await sendQuillbotChat('hi')
    const bodyText = await response.text()
    return c.json({ ok: response.ok, status: response.status, bodyPreview: bodyText.substring(0, 500) })
  } catch (error) {
    return internalProviderErrorResponse('Quillbot debug', error)
  }
})

app.post('/debug/echo', async (c) => {
  const debugError = await ensureDebugAccess(c, { providerId: 'quillbot' })
  if (debugError) {
    return debugError
  }

  const body = await c.req.json().catch(() => null)
  if (!body) {
    return jsonErrorResponse(400, 'Invalid JSON request body')
  }

  return c.json({ echo: true, received: body })
})

export default app.fetch

