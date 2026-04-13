import {
  createProviderApp,
  fetchWithTimeout,
  getCookieHeaderValue,
  internalProviderErrorResponse,
  messageContentAsText,
  upstreamErrorResponse,
  type ChatMessage,
} from '../lib/provider-core'

export const META_MODELS = [{ capabilities: { documents: true, images: false }, id: 'meta-ai', name: 'Meta AI (Llama)' }]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
const CREATE_TEMP_USER_ACTION_ID = '000bd1337ca0dec3ad31de0b09a98df852c8765f06'
const SEND_QUERY_ID = 'dec740c0443e2bfe308fc8db5b9c4fe6'
const GRAPHQL_URL = 'https://www.meta.ai/api/graphql'

type MetaSession = {
  cookies: string
  accessToken: string
  userId: string
}

/**
 * Establish a Meta AI session:
 * 1. GET meta.ai → detect rd_challenge redirect URL
 * 2. POST to rd_challenge URL → obtain rd_challenge cookie
 * 3. GET meta.ai again with cookies → get full page
 * 4. POST createTempUser Server Action → obtain access token
 */
async function createMetaSession(): Promise<MetaSession> {
  // Step 1: Initial GET to detect challenge
  const r1 = await fetchWithTimeout(
    'https://www.meta.ai/',
    { method: 'GET', headers: { 'User-Agent': UA } },
    15000,
  )
  const t1 = await r1.text()
  const challengeMatch = t1.match(/fetch\('([^']+)'/)
  if (!challengeMatch) {
    throw new Error('Failed to find rd_challenge URL')
  }

  // Step 2: POST to challenge URL to get rd_challenge cookie
  const r2 = await fetchWithTimeout(
    'https://www.meta.ai' + challengeMatch[1],
    { method: 'POST', headers: { 'User-Agent': UA } },
    15000,
  )
  const challengeCookies = getCookieHeaderValue(r2.headers)

  // Step 3: GET main page with challenge cookie
  const r3 = await fetchWithTimeout(
    'https://www.meta.ai/',
    { method: 'GET', headers: { 'User-Agent': UA, Cookie: challengeCookies } },
    15000,
  )
  const allCookies = [challengeCookies, getCookieHeaderValue(r3.headers)]
    .filter(Boolean)
    .join('; ')

  // Step 4: Create temp user via Next.js Server Action
  const createResp = await fetchWithTimeout(
    'https://www.meta.ai/',
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: allCookies,
        'Content-Type': 'text/plain;charset=UTF-8',
        'Next-Action': CREATE_TEMP_USER_ACTION_ID,
        Origin: 'https://www.meta.ai',
        Referer: 'https://www.meta.ai/',
        Accept: 'text/x-component',
      },
      body: '[]',
    },
    15000,
  )

  const createText = await createResp.text()
  const rscLine = createText.split('\n').find((l) => l.startsWith('1:'))
  if (!rscLine) {
    throw new Error('Failed to parse createTempUser RSC response')
  }

  const parsed = JSON.parse(rscLine.substring(2)) as {
    data?: {
      newTempUserAuth?: {
        accessToken?: string
        newUser?: { id?: string }
      }
    }
  }

  const accessToken = parsed.data?.newTempUserAuth?.accessToken
  const userId = parsed.data?.newTempUserAuth?.newUser?.id
  if (!accessToken || !userId) {
    throw new Error('Failed to obtain Meta AI access token')
  }

  return { cookies: allCookies, accessToken, userId }
}

function getLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find((m) => m.role === 'user')
}

const app = createProviderApp({
  providerId: 'metaai',
  basePath: '/metaai',
  models: META_MODELS,
  defaultModel: META_MODELS[0].id,
  chat: async (messages) => {
    try {
      const lastMsg = getLastUserMessage(messages)
      if (!lastMsg) {
        return upstreamErrorResponse('Meta AI', 400, 'No user message found')
      }

      const content = messageContentAsText(lastMsg)
      const session = await createMetaSession()

      // Build GraphQL request
      const convId = crypto.randomUUID()
      const userMsgId = crypto.randomUUID()
      const assistantMsgId = crypto.randomUUID()
      const turnId = crypto.randomUUID()
      const uniqueMsgId = `${session.userId}_${Date.now()}`

      const chatResponse = await fetchWithTimeout(
        GRAPHQL_URL,
        {
          method: 'POST',
          headers: {
            'User-Agent': UA,
            Cookie: session.cookies,
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.accessToken}`,
            'X-Abra-User-Id': session.userId,
            Origin: 'https://www.meta.ai',
            Referer: 'https://www.meta.ai/',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            doc_id: SEND_QUERY_ID,
            variables: {
              conversationId: convId,
              content,
              userMessageId: userMsgId,
              assistantMessageId: assistantMsgId,
              entryPoint: 'new_message',
              userUniqueMessageId: uniqueMsgId,
              turnId,
              mode: null,
            },
          }),
        },
        60000,
      )

      if (!chatResponse.ok) {
        const errorText = await chatResponse.text().catch(() => '')
        return upstreamErrorResponse('Meta AI', chatResponse.status, errorText)
      }

      if (!chatResponse.body) {
        return internalProviderErrorResponse('Meta AI', new Error('No response body'))
      }

      // Parse SSE stream → Vercel AI stream format
      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()
      const encoder = new TextEncoder()

      ;(async () => {
        const reader = chatResponse.body!.getReader()
        const decoder = new TextDecoder()
        let lastContent = ''

        try {
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const parts = buffer.split('\n\n')
            buffer = parts.pop() ?? ''

            for (const part of parts) {
              const dataMatch = part.match(/data: (.+)/)
              if (!dataMatch) continue

              try {
                const data = JSON.parse(dataMatch[1]) as {
                  data?: {
                    sendMessageStream?: {
                      content?: string
                      streamingState?: string
                    }
                  }
                }
                const msg = data.data?.sendMessageStream
                if (!msg?.content) continue

                // Meta AI sends cumulative content, emit only the delta
                const delta = msg.content.substring(lastContent.length)
                lastContent = msg.content

                if (delta) {
                  await writer.write(encoder.encode(`0:${JSON.stringify(delta)}\n`))
                }
              } catch {
                // Skip unparseable SSE events
              }
            }
          }

          await writer.write(encoder.encode('d:{"finishReason":"stop"}\n'))
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error)
          await writer.write(encoder.encode(`3:${JSON.stringify(errMsg)}\n`))
          await writer.write(encoder.encode('d:{"finishReason":"error"}\n'))
        } finally {
          await writer.close()
        }
      })()

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (error) {
      return internalProviderErrorResponse('Meta AI', error)
    }
  },
})

export default app.fetch
