type QuillbotNdjsonChunk =
  | { type?: 'content'; content?: string }
  | { type?: 'status'; status?: string }

/**
 * Quillbot may return newline-delimited JSON or SSE (`data: {...}`). Map both to Vercel AI stream lines.
 */
export function parseQuillbotUpstreamToAiStream(
  rawText: string,
  onMalformedChunk?: (error: unknown) => void,
): string {
  const lines = rawText.split(/\r?\n/)
  let output = ''
  let sawCompleted = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let jsonLine = trimmed
    if (trimmed.startsWith('data:')) {
      jsonLine = trimmed.slice(5).trim()
      if (jsonLine === '[DONE]') {
        sawCompleted = true
        continue
      }
    }

    try {
      const chunk = JSON.parse(jsonLine) as QuillbotNdjsonChunk
      if (chunk.type === 'content' && chunk.content) {
        output += `0:${JSON.stringify(chunk.content)}\n`
      } else if (chunk.type === 'status' && chunk.status === 'completed') {
        sawCompleted = true
        output += 'd:{"finishReason":"stop"}\n'
      }
    } catch (error) {
      onMalformedChunk?.(error)
    }
  }

  if (output && !sawCompleted && !output.includes('"finishReason"')) {
    output += 'd:{"finishReason":"stop"}\n'
  }

  return output
}
