import { describe, expect, it } from "vitest";

import {
  estimateSerializedPayloadBytes,
  getTotalAttachmentBytes,
  isSerializedPayloadTooLarge,
  MAX_SERIALIZED_CHAT_REQUEST_BYTES,
} from "./chat-attachments";

describe("chat attachment helpers", () => {
  it("sums attachment sizes", () => {
    expect(getTotalAttachmentBytes([{ size: 512 }, { size: 1024 }, { size: 2048 }])).toBe(3584);
  });

  it("estimates serialized payload size", () => {
    const payload = {
      id: "request-1",
      messages: [{ role: "user", parts: [{ type: "text", text: "hello world" }] }],
      modelId: "openrouter/gpt-4o-mini",
      trigger: "submit-message",
    };

    expect(estimateSerializedPayloadBytes(payload)).toBeGreaterThan(0);
  });

  it("flags payloads above the configured budget", () => {
    const payload = {
      messages: [{ role: "user", content: "x".repeat(MAX_SERIALIZED_CHAT_REQUEST_BYTES) }],
    };

    expect(isSerializedPayloadTooLarge(payload)).toBe(true);
  });
});
