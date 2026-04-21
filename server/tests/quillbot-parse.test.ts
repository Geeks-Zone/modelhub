import { describe, expect, it } from "vitest";

import { parseQuillbotUpstreamToAiStream } from "../lib/quillbot-stream";

describe("quillbot upstream parsing", () => {
  it("parses NDJSON lines", () => {
    const raw = [
      JSON.stringify({ type: "content", content: "Hello" }),
      JSON.stringify({ type: "status", status: "completed" }),
    ].join("\n");
    const out = parseQuillbotUpstreamToAiStream(raw);
    expect(out).toContain("0:");
    expect(out).toContain("finishReason");
  });

  it("parses SSE data: lines", () => {
    const raw = [
      'data: {"type":"content","content":"Hi"}',
      'data: {"type":"status","status":"completed"}',
    ].join("\n");
    const out = parseQuillbotUpstreamToAiStream(raw);
    expect(out).toContain("0:");
    expect(out).toContain("finishReason");
  });

  it("appends stop when content but no completed", () => {
    const raw = JSON.stringify({ type: "content", content: "Only" });
    const out = parseQuillbotUpstreamToAiStream(raw);
    expect(out).toContain("finishReason");
  });
});
