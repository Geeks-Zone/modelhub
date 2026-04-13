import { Hono } from 'hono'
import { z } from 'zod'

import type { ProviderModelCapabilities } from '@/lib/chat-parts'
import { prisma } from './db'
import { decryptCredential } from './crypto'
import { getCachedModels } from './model-cache'
import {
  MAX_DOCUMENT_CONTEXT_CHARS,
  buildDocumentContextBlock,
} from './conversation-attachments'
import { ensureProtectedAccess, isProductionEnv, protectedCors, securityHeaders } from './security'

export type ChatMessageToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | ChatMessageContentPart[]
  tool_calls?: ChatMessageToolCall[]
  tool_call_id?: string
  name?: string
}

export type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }

type ChatInputAttachmentPart = {
  attachmentId: string
  fileName: string
  kind: 'document' | 'image'
  mimeType: string
  type: 'attachment'
}

type ChatInputContentPart = ChatMessageContentPart | ChatInputAttachmentPart

type ChatInputMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | ChatInputContentPart[]
  tool_calls?: ChatMessageToolCall[]
  tool_call_id?: string
  name?: string
}

export type ProviderModel = {
  capabilities: ProviderModelCapabilities
  id: string
  name: string
}

type RawMessagePart = {
  attachmentId?: string
  fileName?: string
  kind?: string
  mimeType?: string
  type?: string
  text?: string
  image_url?: { url?: string; detail?: string }
}

type RawChatMessage = {
  role?: 'user' | 'assistant' | 'system' | 'tool'
  content?: string | RawMessagePart[]
  parts?: RawMessagePart[]
  tool_calls?: ChatMessageToolCall[]
  tool_call_id?: string
  name?: string
}

type OpenAiSseContentPart = {
  text?: string
}

type OpenAiSseToolCallDelta = {
  index: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

type OpenAiSseChunk = {
  choices?: Array<{
    delta?: {
      content?: string | OpenAiSseContentPart[]
      tool_calls?: OpenAiSseToolCallDelta[]
    }
    finish_reason?: string | null
  }>
}

type AccumulatedToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const MAX_MESSAGES = 50
const MAX_PARTS_PER_MESSAGE = 64
const MAX_MESSAGE_TEXT_LENGTH = 20_000
export const MAX_PROVIDER_REQUEST_BODY_BYTES = 4 * 1024 * 1024
const MAX_PROVIDER_IMAGE_URL_LENGTH = 4 * 1024 * 1024

const rawMessagePartSchema = z
  .object({
    attachmentId: z.string().max(256).optional(),
    fileName: z.string().max(512).optional(),
    kind: z.enum(['image', 'document']).optional(),
    mimeType: z.string().max(256).optional(),
    type: z.string().max(64).optional(),
    text: z.string().max(MAX_MESSAGE_TEXT_LENGTH).optional(),
    image_url: z
      .object({
        url: z.string().max(MAX_PROVIDER_IMAGE_URL_LENGTH).optional(),
        detail: z.string().max(32).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const toolCallFunctionSchema = z.object({
  name: z.string().max(256),
  arguments: z.string().max(MAX_MESSAGE_TEXT_LENGTH),
})

const toolCallSchema = z.object({
  id: z.string().max(256),
  type: z.literal('function'),
  function: toolCallFunctionSchema,
})

const rawChatMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    content: z
      .union([z.string().max(MAX_MESSAGE_TEXT_LENGTH), z.array(rawMessagePartSchema).max(MAX_PARTS_PER_MESSAGE)])
      .optional(),
    parts: z.array(rawMessagePartSchema).max(MAX_PARTS_PER_MESSAGE).optional(),
    tool_calls: z.array(toolCallSchema).max(64).optional(),
    tool_call_id: z.string().max(256).optional(),
    name: z.string().max(256).optional(),
  })
  .passthrough()

const providerChatBodySchema = z
  .object({
    modelId: z.string().trim().min(1).max(200).optional(),
    messages: z.array(rawChatMessageSchema).min(1).max(MAX_MESSAGES),
  })
  .passthrough()

type ProviderConfig = {
  providerId: string
  basePath: string
  models: ProviderModel[]
  defaultModel: string
  chat: (
    messages: ChatMessage[],
    modelId: string,
    rawBody: Record<string, unknown>,
    credentials: Record<string, string>,
    userId?: string,
  ) => Promise<Response>
  /** Optional function to test credentials against the upstream provider. */
  testCredentials?: (credentials: Record<string, string>) => Promise<{ ok: boolean; error?: string }>
  /** Optional function to fetch models dynamically from upstream. Results are cached with TTL. */
  fetchModels?: (credentials?: Record<string, string>) => Promise<ProviderModel[]>
}

function normalizeContentParts(parts: RawMessagePart[]): ChatInputContentPart[] {
  const out: ChatInputContentPart[] = []
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      out.push({ type: 'text', text: part.text })
    } else if (part.type === 'image_url' && part.image_url?.url) {
      out.push({ type: 'image_url', image_url: { url: part.image_url.url, detail: part.image_url.detail } })
    } else if (
      part.type === 'attachment' &&
      typeof part.attachmentId === 'string' &&
      (part.kind === 'image' || part.kind === 'document') &&
      typeof part.fileName === 'string' &&
      typeof part.mimeType === 'string'
    ) {
      out.push({
        attachmentId: part.attachmentId,
        fileName: part.fileName,
        kind: part.kind,
        mimeType: part.mimeType,
        type: 'attachment',
      })
    }
  }
  return out
}

function normalizeMessages(input: RawChatMessage[]): ChatInputMessage[] {
  if (!Array.isArray(input)) return []

  const out: ChatInputMessage[] = []
  for (const item of input) {
    const role: ChatInputMessage['role'] =
      item.role === 'assistant' || item.role === 'system' || item.role === 'tool' ? item.role : 'user'

    let content: string | ChatInputContentPart[] = ''

    if (typeof item.content === 'string') {
      content = item.content
    } else if (Array.isArray(item.content)) {
      const parts = normalizeContentParts(item.content)
      content = parts.length > 0 ? parts : ''
    } else if (Array.isArray(item.parts)) {
      const parts = normalizeContentParts(item.parts)
      content = parts.length > 0 ? parts : ''
    }

    const msg: ChatInputMessage = { role, content }

    if (item.tool_calls && Array.isArray(item.tool_calls) && item.tool_calls.length > 0) {
      msg.tool_calls = item.tool_calls
    }
    if (typeof item.tool_call_id === 'string' && item.tool_call_id) {
      msg.tool_call_id = item.tool_call_id
    }
    if (typeof item.name === 'string' && item.name) {
      msg.name = item.name
    }

    out.push(msg)
  }

  return out
}

class AttachmentCapabilityError extends Error {
  status = 400
}

function toDataUrl(mimeType: string, blob: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(blob).toString('base64')}`
}

async function getModelCapabilities(
  config: ProviderConfig,
  modelId: string,
  credentials: Record<string, string>,
): Promise<ProviderModelCapabilities> {
  const staticMatch = config.models.find((model) => model.id === modelId)
  if (staticMatch) {
    return staticMatch.capabilities
  }

  if (config.fetchModels) {
    const fetchedModels = await getCachedModels(
      config.providerId,
      () => config.fetchModels?.(credentials) ?? Promise.resolve([]),
      config.models,
    )
    const dynamicMatch = fetchedModels.find((model) => model.id === modelId)
    if (dynamicMatch) {
      return dynamicMatch.capabilities
    }
  }

  return { documents: true, images: false }
}

export async function resolveMessagesForProvider(input: {
  config: ProviderConfig
  credentials: Record<string, string>
  messages: ChatInputMessage[]
  modelId: string
  userId?: string
}): Promise<ChatMessage[]> {
  const modelCapabilities = await getModelCapabilities(input.config, input.modelId, input.credentials)
  const attachmentIds = new Set<string>()

  for (const message of input.messages) {
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === 'attachment') {
        attachmentIds.add(part.attachmentId)
      }
    }
  }

  let attachmentsById = new Map<
    string,
    {
      blob: Uint8Array
      extractedText: string | null
      extractionStatus: 'completed' | 'failed' | 'processing' | 'unsupported_scan'
      fileName: string
      id: string
      kind: 'document' | 'image'
      mimeType: string
    }
  >()

  if (attachmentIds.size > 0) {
    if (!input.userId) {
      throw new AttachmentCapabilityError('Authenticated user context is required for attachments')
    }

    const rows = await prisma.conversationAttachment.findMany({
      where: {
        conversation: { userId: input.userId },
        id: { in: [...attachmentIds] },
      },
      select: {
        blob: true,
        extractedText: true,
        extractionStatus: true,
        fileName: true,
        id: true,
        kind: true,
        mimeType: true,
      },
    })

    attachmentsById = new Map(
      rows.map((row) => [
        row.id,
        {
          blob: row.blob,
          extractedText: row.extractedText,
          extractionStatus: row.extractionStatus as 'completed' | 'failed' | 'processing' | 'unsupported_scan',
          fileName: row.fileName,
          id: row.id,
          kind: row.kind as 'document' | 'image',
          mimeType: row.mimeType,
        },
      ]),
    )
  }

  // Inject custom instructions and memories as a system message
  const resolvedMessages: ChatMessage[] = []
  if (input.userId) {
    const [userSettings, userMemories] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId: input.userId } }),
      prisma.userMemory.findMany({
        where: { userId: input.userId },
        select: { content: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])

    const systemParts: string[] = []
    if (userSettings?.customInstructionsAbout) {
      systemParts.push(`About the user: ${userSettings.customInstructionsAbout}`)
    }
    if (userSettings?.customInstructionsStyle) {
      systemParts.push(`Response style: ${userSettings.customInstructionsStyle}`)
    }
    if (userMemories.length > 0) {
      systemParts.push(`User memories:\n${userMemories.map((m) => `- ${m.content}`).join('\n')}`)
    }

    if (systemParts.length > 0) {
      resolvedMessages.push({
        role: 'system',
        content: systemParts.join('\n\n'),
      })
    }
  }

  for (const message of input.messages) {
    if (typeof message.content === 'string') {
      resolvedMessages.push({ ...message, content: message.content })
      continue
    }

    let remainingDocumentChars = MAX_DOCUMENT_CONTEXT_CHARS
    const contentParts: ChatMessageContentPart[] = []
    for (const part of message.content) {
      if (part.type === 'text' || part.type === 'image_url') {
        contentParts.push(part)
        continue
      }

      const attachment = attachmentsById.get(part.attachmentId)
      if (!attachment) {
        throw new AttachmentCapabilityError(`Attachment "${part.fileName}" was not found`)
      }

      if (attachment.kind === 'image') {
        if (!modelCapabilities.images) {
          throw new AttachmentCapabilityError(`Modelo "${input.modelId}" nao suporta anexos de imagem`)
        }

        contentParts.push({
          type: 'image_url',
          image_url: { url: toDataUrl(attachment.mimeType, attachment.blob) },
        })
        continue
      }

      const documentBlock = buildDocumentContextBlock({
        extractedText: attachment.extractedText,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        remainingChars: remainingDocumentChars,
        status: attachment.extractionStatus,
      })
      if (documentBlock.text) {
        contentParts.push({ type: 'text', text: documentBlock.text })
      }
      remainingDocumentChars = Math.max(0, remainingDocumentChars - documentBlock.consumedChars)
    }

    resolvedMessages.push({
      ...message,
      content: contentParts.length > 0 ? contentParts : '',
    })
  }

  return resolvedMessages
}

/**
 * Extract plain text from ChatMessage content (for providers that only support text).
 * Strips AI coding assistant system context (e.g. Kilo Code / Cline environment_details)
 * that simple models would otherwise echo back verbatim.
 */
export function messageContentAsText(msg: ChatMessage): string {
  let raw: string
  if (typeof msg.content === 'string') {
    raw = msg.content
  } else {
    raw = msg.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
  }

  return stripCodingAssistantContext(raw)
}

/** Remove known AI coding assistant metadata blocks that simple models echo back. */
function stripCodingAssistantContext(text: string): string {
  // Strip <environment_details>...</environment_details> blocks (Kilo Code / Cline / Roo Code)
  let cleaned = text.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, '')

  // Unwrap <task>...</task> to just the inner content
  cleaned = cleaned.replace(/<task>\s*([\s\S]*?)\s*<\/task>/g, '$1')

  return cleaned.trim()
}

function extractSseTextDelta(parsed: OpenAiSseChunk | null): string {
  const delta = parsed?.choices?.[0]?.delta
  if (!delta) return ''

  if (typeof delta.content === 'string') {
    return delta.content
  }

  if (Array.isArray(delta.content)) {
    return delta.content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
  }

  return ''
}

async function writeFinish(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reason = 'stop',
): Promise<void> {
  const encoder = new TextEncoder()
  await writer.write(encoder.encode(`d:${JSON.stringify({ finishReason: reason })}\n`))
}

function logParsingIssue(context: string, error: unknown): void {
  if (!isProductionEnv()) {
    console.warn(context, error)
  }
}

function accumulateToolCallDeltas(
  deltas: OpenAiSseToolCallDelta[],
  accumulated: Map<number, AccumulatedToolCall>,
): void {
  for (const tc of deltas) {
    const existing = accumulated.get(tc.index)
    if (existing) {
      if (tc.function?.arguments) {
        existing.function.arguments += tc.function.arguments
      }
    } else {
      accumulated.set(tc.index, {
        id: tc.id || '',
        type: 'function',
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        },
      })
    }
  }
}

async function flushAccumulatedToolCalls(
  accumulated: Map<number, AccumulatedToolCall>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
  const encoder = new TextEncoder()
  for (const [, tc] of accumulated) {
    if (!tc.id || !tc.function.name) continue
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments) as Record<string, unknown>
    } catch {
      // arguments may be empty or invalid — send as-is string wrapped
      args = { _raw: tc.function.arguments }
    }
    const payload = { toolCallId: tc.id, toolName: tc.function.name, args }
    await writer.write(encoder.encode(`9:${JSON.stringify(payload)}\n`))
  }
  accumulated.clear()
}

async function processSseLine(
  lineRaw: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  toolCallAccumulator: Map<number, AccumulatedToolCall>,
): Promise<boolean> {
  const encoder = new TextEncoder()
  const line = lineRaw.trim()
  if (!line.startsWith('data:')) return false

  const data = line.slice(5).trim()
  if (!data) return false

  if (data === '[DONE]') {
    await flushAccumulatedToolCalls(toolCallAccumulator, writer)
    await writeFinish(writer)
    return true
  }

  try {
    const parsed = JSON.parse(data) as OpenAiSseChunk
    const token = extractSseTextDelta(parsed)
    if (token) {
      await writer.write(encoder.encode(`0:${JSON.stringify(token)}\n`))
    }

    const toolCallDeltas = parsed.choices?.[0]?.delta?.tool_calls
    if (toolCallDeltas && Array.isArray(toolCallDeltas)) {
      accumulateToolCallDeltas(toolCallDeltas, toolCallAccumulator)
    }

    const finishReason = parsed.choices?.[0]?.finish_reason
    if (finishReason && finishReason !== 'null') {
      await flushAccumulatedToolCalls(toolCallAccumulator, writer)
      await writeFinish(writer, finishReason === 'tool_calls' ? 'tool-calls' : finishReason)
      return true
    }
  } catch (error) {
    logParsingIssue('Ignoring malformed upstream SSE chunk.', error)
  }

  return false
}

export function toVercelStreamFromOpenAiSse(upstream: Response): Response {
  const decoder = new TextDecoder()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const toolCallAccumulator = new Map<number, AccumulatedToolCall>()

  ;(async () => {
    let didFinish = false
    try {
      const reader = upstream.body?.getReader()
      if (!reader) throw new Error('Upstream response has no body stream')

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const lineRaw of lines) {
          didFinish = (await processSseLine(lineRaw, writer, toolCallAccumulator)) || didFinish
        }
      }

      if (!didFinish) {
        await flushAccumulatedToolCalls(toolCallAccumulator, writer)
        await writeFinish(writer)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const encoder = new TextEncoder()
      await writer.write(encoder.encode(`3:${JSON.stringify(message)}\n`))
      await writeFinish(writer, 'error')
    } finally {
      await writer.close()
    }
  })()

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  })
}

export function toVercelSingleTextResponse(text: string): Response {
  const payload = `0:${JSON.stringify(text)}\nd:{"finishReason":"stop"}\n`
  return new Response(payload, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}

export function toVercelToolCallsResponse(
  toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>,
  textContent?: string,
): Response {
  let payload = ''
  if (textContent) {
    payload += `0:${JSON.stringify(textContent)}\n`
  }
  for (const tc of toolCalls) {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments) as Record<string, unknown>
    } catch {
      args = { _raw: tc.function.arguments }
    }
    payload += `9:${JSON.stringify({ toolCallId: tc.id, toolName: tc.function.name, args })}\n`
  }
  payload += `d:{"finishReason":"tool-calls"}\n`
  return new Response(payload, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}

/**
 * Convert a Vercel AI SDK stream response to OpenAI-compatible SSE format.
 * Vercel format: `0:"text"\n`, `9:{toolCall}\n`, `d:{"finishReason":"stop"}\n`
 * OpenAI format: `data: {"choices":[{"delta":{"content":"text"}}]}\n\n`
 */
export function vercelStreamToOpenAiSse(vercelResponse: Response, model: string): Response {
  // Pass through non-2xx responses as OpenAI-compatible error JSON
  if (!vercelResponse.ok) {
    return vercelResponse
  }

  const chatId = `chatcmpl-${Date.now()}`
  const created = Math.floor(Date.now() / 1000)

  // Non-streaming: collect full body and return as single JSON
  if (!vercelResponse.body) {
    return toOpenAiNonStreamingResponse(vercelResponse, model, chatId, created)
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  ;(async () => {
    try {
      const reader = vercelResponse.body!.getReader()
      let buffer = ''
      const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line) continue
          const colonIdx = line.indexOf(':')
          if (colonIdx < 0) continue

          const prefix = line.substring(0, colonIdx)
          const payload = line.substring(colonIdx + 1)

          if (prefix === '0') {
            // Text chunk
            const text = JSON.parse(payload) as string
            const chunk = {
              id: chatId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            }
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          } else if (prefix === '9') {
            // Tool call
            const tc = JSON.parse(payload) as { toolCallId: string; toolName: string; args: unknown }
            toolCalls.push({
              id: tc.toolCallId,
              type: 'function',
              function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
            })
          } else if (prefix === 'd') {
            // Finish
            const data = JSON.parse(payload) as { finishReason: string }
            const finishReason = data.finishReason === 'tool-calls' ? 'tool_calls' : data.finishReason
            const delta: Record<string, unknown> = {}
            if (toolCalls.length > 0) {
              delta.tool_calls = toolCalls.map((tc, i) => ({ index: i, ...tc }))
            }
            const chunk = {
              id: chatId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta, finish_reason: finishReason }],
            }
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
            await writer.write(encoder.encode('data: [DONE]\n\n'))
          } else if (prefix === '3') {
            // Error
            const errMsg = JSON.parse(payload) as string
            const chunk = {
              id: chatId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta: { content: `[Error: ${errMsg}]` }, finish_reason: null }],
            }
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          }
        }
      }
    } catch {
      // Stream ended unexpectedly — send DONE to close cleanly
      await writer.write(encoder.encode('data: [DONE]\n\n'))
    } finally {
      await writer.close()
    }
  })()

  return new Response(readable, {
    status: vercelResponse.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function toOpenAiNonStreamingResponse(
  vercelResponse: Response,
  model: string,
  chatId: string,
  created: number,
): Response {
  const body = {
    id: chatId,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: '' },
      finish_reason: 'stop',
    }],
  }
  return new Response(JSON.stringify(body), {
    status: vercelResponse.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function jsonErrorResponse(
  status: number,
  error: string,
  details?: Record<string, unknown>,
): Response {
  const body = details ? { error, ...details } : { error }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`CONFIG_ERROR:${name}`)
  }

  return value
}

export function resolveEnv(name: string, credentials?: Record<string, string>): string {
  const fromCredentials = credentials?.[name]
  if (fromCredentials) {
    return fromCredentials
  }

  return requireEnv(name)
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function parseCredentialsHeader(request: { header: (name: string) => string | undefined }): Record<string, string> {
  const raw = request.header('x-provider-credentials')
  if (!raw) return {}

  try {
    const decoded = atob(raw)
    const parsed: unknown = JSON.parse(decoded)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const result: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.length > 0) {
          result[key] = value
        }
      }
      return result
    }
  } catch {
    // Invalid header, ignore
  }

  return {}
}

/**
 * Busca as credenciais do usuário para um provedor específico no banco de dados,
 * descriptografa e retorna como Record<string, string>.
 * Se não houver userId ou credenciais, retorna objeto vazio.
 */
async function getUserProviderCredentials(
  userId: string | undefined,
  providerId: string,
): Promise<Record<string, string>> {
  if (!userId) return {}

  try {
    const rows = await prisma.providerCredential.findMany({
      where: { userId, providerId },
      select: { credentialKey: true, credentialValue: true },
    })

    const result: Record<string, string> = {}
    for (const row of rows) {
      try {
        result[row.credentialKey] = decryptCredential(row.credentialValue)
      } catch {
        console.error(`[${providerId}] Failed to decrypt credential "${row.credentialKey}" for user ${userId}`)
      }
    }
    return result
  } catch (error) {
    console.error(`[${providerId}] Failed to load user credentials`, error)
    return {}
  }
}

function logProviderError(providerId: string, error: unknown): void {
  console.error(`[${providerId}] request failed`, error)
}

/**
 * Registra uso no banco de dados em background (fire-and-forget).
 * Nunca lança erro — falhas são logadas silenciosamente.
 */
function logUsage(data: {
  userId: string | undefined
  apiKeyId: string | undefined
  providerId: string
  modelId: string | undefined
  endpoint: string | undefined
  statusCode: number
}): void {
  if (!data.userId) return // Sem usuário autenticado, não loga

  prisma.usageLog.create({
    data: {
      userId: data.userId,
      apiKeyId: data.apiKeyId ?? null,
      providerId: data.providerId,
      modelId: data.modelId ?? null,
      endpoint: data.endpoint ?? null,
      statusCode: data.statusCode,
    },
  }).catch((err: unknown) => {
    console.error('[usage-log] Failed to record usage', err)
  })
}

export function upstreamErrorResponse(
  providerName: string,
  status: number,
  detailsForLog?: string,
): Response {
  if (detailsForLog) {
    console.error(`[${providerName}] upstream error ${status}: ${detailsForLog.slice(0, 500)}`)
  } else {
    console.error(`[${providerName}] upstream error ${status}`)
  }

  return jsonErrorResponse(status, `${providerName} upstream error`)
}

export function internalProviderErrorResponse(providerName: string, error: unknown): Response {
  console.error(`[${providerName}] internal error`, error)
  return jsonErrorResponse(500, `${providerName} request failed`)
}

function splitCombinedSetCookieHeader(headerValue: string): string[] {
  return headerValue
    .split(/,(?=\s*[^=;,\s]+=[^;])/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getSetCookieHeaders(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[]
  }

  if (typeof headersWithGetSetCookie.getSetCookie === 'function') {
    return headersWithGetSetCookie.getSetCookie().filter(Boolean)
  }

  const collectedHeaders: string[] = []
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      collectedHeaders.push(...splitCombinedSetCookieHeader(value))
    }
  })

  if (collectedHeaders.length > 0) {
    return collectedHeaders
  }

  const singleHeader = headers.get('set-cookie')
  return singleHeader ? splitCombinedSetCookieHeader(singleHeader) : []
}

export function getCookieHeaderValue(headers: Headers): string {
  return getSetCookieHeaders(headers)
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

type AppEnv = {
  Variables: {
    userId: string
    apiKeyId: string
  }
}

export function createProviderApp(config: ProviderConfig) {
  const app = new Hono<AppEnv>().basePath(config.basePath)

  app.use('*', securityHeaders)
  app.use('*', protectedCors)
  app.use('*', async (c, next) => {
    const accessError = await ensureProtectedAccess(c, { providerId: config.providerId })
    if (accessError) {
      return accessError
    }

    await next()
  })

  app.get('/api/models', async (c) => {
    const userId = c.get('userId') as string | undefined
    const dbCredentials = await getUserProviderCredentials(userId, config.providerId)
    const headerCredentials = parseCredentialsHeader(c.req)
    const credentials = { ...dbCredentials, ...headerCredentials }

    if (config.fetchModels) {
      const models = await getCachedModels(
        config.providerId,
        () => config.fetchModels?.(credentials) ?? Promise.resolve([]),
        config.models,
      )
      return c.json({ models })
    }
    return c.json({ models: config.models })
  })

  app.post('/api/test', async (c) => {
    try {
      // Merge: header > db > env (mesma lógica do /api/chat)
      const userId = c.get('userId') as string | undefined
      const dbCredentials = await getUserProviderCredentials(userId, config.providerId)
      const headerCredentials = parseCredentialsHeader(c.req)
      const credentials = { ...dbCredentials, ...headerCredentials }

      if (Object.keys(credentials).length === 0) {
        return c.json({ ok: false, error: 'Nenhuma credencial fornecida para teste.' }, 400)
      }

      if (!config.testCredentials) {
        // Provider does not support credential testing — accept gracefully
        return c.json({ ok: true, skipped: true })
      }

      const result = await config.testCredentials(credentials)
      return c.json(result, result.ok ? 200 : 401)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido ao testar credenciais.'
      return c.json({ ok: false, error: message }, 500)
    }
  })

  app.post('/api/chat', async (c) => {
    try {
      const contentLengthHeader = c.req.header('content-length')
      if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader)
        if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_REQUEST_BODY_BYTES) {
          return jsonErrorResponse(413, 'Request body too large')
        }
      }

      const rawRequestBody = await c.req.text()
      if (getUtf8ByteLength(rawRequestBody) > MAX_PROVIDER_REQUEST_BODY_BYTES) {
        return jsonErrorResponse(413, 'Request body too large')
      }

      let rawJson: unknown
      try {
        rawJson = JSON.parse(rawRequestBody) as unknown
      } catch {
        return jsonErrorResponse(400, 'Invalid JSON request body')
      }

      const parsedBody = providerChatBodySchema.safeParse(rawJson)
      if (!parsedBody.success) {
        return jsonErrorResponse(400, 'Invalid chat request payload')
      }

      const rawBody = parsedBody.data as Record<string, unknown>
      const modelId = parsedBody.data.modelId || config.defaultModel
      const messages = normalizeMessages(parsedBody.data.messages)

      if (!messages.length) {
        return jsonErrorResponse(400, 'messages must be a non-empty array')
      }

      // 1. Credenciais do banco (menor prioridade)
      const userId = c.get('userId') as string | undefined
      const apiKeyId = c.get('apiKeyId') as string | undefined
      const dbCredentials = await getUserProviderCredentials(userId, config.providerId)

      // 2. Credenciais do header (maior prioridade — sobrescrevem as do banco)
      const headerCredentials = parseCredentialsHeader(c.req)

      // Merge: header > db > env (env é resolvido em resolveEnv)
      const credentials = { ...dbCredentials, ...headerCredentials }

      const resolvedMessages = await resolveMessagesForProvider({
        config,
        credentials,
        messages,
        modelId,
        userId,
      })

      const response = await config.chat(resolvedMessages, modelId, rawBody, credentials, userId)

      // Usage logging (fire-and-forget)
      logUsage({
        userId,
        apiKeyId,
        providerId: config.providerId,
        modelId,
        endpoint: c.req.path,
        statusCode: response.status,
      })

      return response
    } catch (error) {
      if (error instanceof AttachmentCapabilityError) {
        return jsonErrorResponse(error.status, error.message)
      }

      if (error instanceof Error && error.message.startsWith('CONFIG_ERROR:')) {
        return jsonErrorResponse(503, 'Provider is not configured')
      }

      logProviderError(config.providerId, error)

      // Log falhas também
      logUsage({
        userId: c.get('userId') as string | undefined,
        apiKeyId: c.get('apiKeyId') as string | undefined,
        providerId: config.providerId,
        modelId: undefined,
        endpoint: c.req.path,
        statusCode: 500,
      })

      return jsonErrorResponse(500, 'Unable to process provider request')
    }
  })

  return app
}

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs = 45000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function postJsonWithTimeout(
  url: string,
  init: {
    headers?: Record<string, string>
    body: unknown
    timeoutMs?: number
  },
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (init.headers) {
    Object.assign(headers, init.headers)
  }

  return fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(init.body),
    },
    init.timeoutMs ?? 45000,
  )
}
