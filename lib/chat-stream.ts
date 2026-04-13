import type { StreamEvent } from "@/lib/contracts";

export type ParsedToolCall = {
  args: unknown;
  result?: unknown;
  status: "running" | "completed";
  toolCallId: string;
  toolName: string;
};

export type ParsedChatStreamResult = {
  errorMessage?: string;
  hadPartialOutput: boolean;
  text: string;
};

type ParseStreamHandlers = {
  onEvent?: (event: StreamEvent) => void;
  onTextDelta?: (delta: string) => void;
  onToolStart?: (toolCall: ParsedToolCall) => void;
  onToolResult?: (toolCallId: string, result: unknown) => void;
};

export async function parseChatStream(
  response: Response,
  handlers: ParseStreamHandlers,
): Promise<ParsedChatStreamResult> {
  if (!response.body) {
    throw new Error("A resposta veio sem stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let errorMessage: string | undefined;
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (line.startsWith("0:")) {
        const delta = JSON.parse(line.slice(2)) as string;
        fullText += delta;
        handlers.onEvent?.({ delta, type: "text-delta" });
        handlers.onTextDelta?.(delta);
        continue;
      }

      if (line.startsWith("9:")) {
        const payload = JSON.parse(line.slice(2)) as {
          args?: unknown;
          toolCallId: string;
          toolName: string;
        };
        handlers.onEvent?.({
          args: payload.args ?? {},
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          type: "tool-start",
        });
        handlers.onToolStart?.({
          args: payload.args ?? {},
          status: "running",
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
        });
        continue;
      }

      if (line.startsWith("a:")) {
        const payload = JSON.parse(line.slice(2)) as {
          result?: unknown;
          toolCallId: string;
        };
        handlers.onEvent?.({
          result: payload.result ?? null,
          toolCallId: payload.toolCallId,
          type: "tool-result",
        });
        handlers.onToolResult?.(payload.toolCallId, payload.result ?? null);
        continue;
      }

      if (line.startsWith("3:")) {
        const payload = JSON.parse(line.slice(2)) as string;
        errorMessage = payload;
        continue;
      }

      if (line.startsWith("data: ")) {
        const dataContent = line.slice(6).trim();

        // OpenAI SSE streams send "data: [DONE]" as end-of-stream marker.
        // Proxy providers (e.g. Gateway) forward raw SSE without transformation,
        // so the client must handle this sentinel gracefully.
        if (dataContent === "[DONE]") {
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload = JSON.parse(dataContent) as Record<string, any>;

        // Internal format (transformed by provider-core)
        if (payload.type === "text-delta" && payload.delta) {
          fullText += payload.delta as string;
          handlers.onEvent?.({ delta: payload.delta as string, type: "text-delta" });
          handlers.onTextDelta?.(payload.delta as string);
        } else if (payload.type === "tool-call" && payload.toolCallId && payload.toolName) {
          handlers.onEvent?.({
            args: (payload.args as Record<string, unknown>) ?? {},
            toolCallId: payload.toolCallId as string,
            toolName: payload.toolName as string,
            type: "tool-start",
          });
          handlers.onToolStart?.({
            args: (payload.args as Record<string, unknown>) ?? {},
            status: "running",
            toolCallId: payload.toolCallId as string,
            toolName: payload.toolName as string,
          });
        } else if (payload.type === "tool-result" && payload.toolCallId) {
          handlers.onEvent?.({
            result: (payload.result as unknown) ?? null,
            toolCallId: payload.toolCallId as string,
            type: "tool-result",
          });
          handlers.onToolResult?.(payload.toolCallId as string, (payload.result as unknown) ?? null);
        } else if (Array.isArray(payload.choices)) {
          // Raw OpenAI SSE format — proxy providers (Gateway) forward this untransformed
          const delta = payload.choices[0]?.delta;
          if (delta) {
            const text =
              typeof delta.content === "string"
                ? delta.content
                : Array.isArray(delta.content)
                  ? (delta.content as Array<{ text?: string }>)
                      .map((p) => (typeof p.text === "string" ? p.text : ""))
                      .join("")
                  : "";
            if (text) {
              fullText += text;
              handlers.onEvent?.({ delta: text, type: "text-delta" });
              handlers.onTextDelta?.(text);
            }
          }
        }
      }
    }
  }

  return {
    errorMessage,
    hadPartialOutput: fullText.length > 0,
    text: fullText,
  };
}
