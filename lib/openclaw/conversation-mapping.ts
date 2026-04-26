import { extractPlainTextFromParts, type ConversationMessagePart, type HydratedConversationMessagePart } from "@/lib/chat-parts";
import type { ProviderModel } from "@/lib/contracts";

type ConversationLike = {
  content?: string;
  parts?: ConversationMessagePart[] | HydratedConversationMessagePart[];
  role: "assistant" | "user";
};

export function buildModelhubOpenClawModelId(providerId: string, modelId: string): string {
  return `modelhub/${providerId}/${modelId}`;
}

export function mergeOpenClawModelLists(
  gatewayModels: ProviderModel[],
  catalogModels: ProviderModel[],
): ProviderModel[] {
  const seen = new Set<string>();
  const merged: ProviderModel[] = [];
  for (const m of gatewayModels) {
    if (seen.has(m.id)) {
      continue;
    }
    seen.add(m.id);
    merged.push(m);
  }
  for (const m of catalogModels) {
    if (seen.has(m.id)) {
      continue;
    }
    seen.add(m.id);
    merged.push(m);
  }
  return merged;
}

export function conversationToOpenAiMessages(
  messages: ConversationLike[],
): { content: string; role: "assistant" | "system" | "user" }[] {
  const out: { content: string; role: "assistant" | "system" | "user" }[] = [];
  for (const m of messages) {
    const text =
      m.parts && m.parts.length > 0 ? extractPlainTextFromParts(m.parts) : (m.content ?? "");
    const content = (text ?? "").trim();
    if (!content) {
      continue;
    }
    out.push({
      content,
      role: m.role === "assistant" ? "assistant" : "user",
    });
  }
  return out;
}
