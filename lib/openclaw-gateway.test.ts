import { describe, expect, it } from "vitest";

import {
  buildModelhubOpenClawModelId,
  buildOpenClawDashboardUrl,
  conversationToOpenAiMessages,
  mergeOpenClawModelLists,
  normalizeGatewayBaseUrl,
} from "@/lib/openclaw-gateway";

describe("normalizeGatewayBaseUrl", () => {
  it("adds http scheme and strips trailing slash", () => {
    expect(normalizeGatewayBaseUrl("127.0.0.1:18789")).toBe("http://127.0.0.1:18789");
    expect(normalizeGatewayBaseUrl("http://127.0.0.1:18789/")).toBe("http://127.0.0.1:18789");
  });

  it("removes trailing /v1", () => {
    expect(normalizeGatewayBaseUrl("http://127.0.0.1:18789/v1")).toBe("http://127.0.0.1:18789");
    expect(normalizeGatewayBaseUrl("http://127.0.0.1:18789/v1/")).toBe("http://127.0.0.1:18789");
  });

  it("preserves https scheme", () => {
    expect(normalizeGatewayBaseUrl("https://my-gateway.example.com/v1")).toBe(
      "https://my-gateway.example.com",
    );
  });

  it("returns default for empty input", () => {
    expect(normalizeGatewayBaseUrl("")).toBe("http://127.0.0.1:18789");
    expect(normalizeGatewayBaseUrl("   ")).toBe("http://127.0.0.1:18789");
  });

  it("removes multiple trailing slashes", () => {
    expect(normalizeGatewayBaseUrl("http://localhost:18789///")).toBe("http://localhost:18789");
  });
});

describe("buildOpenClawDashboardUrl", () => {
  it("returns null without token", () => {
    expect(buildOpenClawDashboardUrl({ baseUrl: "http://127.0.0.1:18789", token: "  " })).toBeNull();
  });

  it("builds hash URL like openclaw dashboard", () => {
    const url = buildOpenClawDashboardUrl({ baseUrl: "http://127.0.0.1:18789", token: "abc/def" });
    expect(url).toBe("http://127.0.0.1:18789/#token=abc%2Fdef");
  });

  it("returns null for a non-loopback base URL", () => {
    expect(buildOpenClawDashboardUrl({ baseUrl: "https://example.com", token: "abc" })).toBeNull();
  });
});

describe("buildModelhubOpenClawModelId", () => {
  it("prefixes provider and model id", () => {
    expect(buildModelhubOpenClawModelId("quillbot", "quillbot-ai")).toBe("modelhub/quillbot/quillbot-ai");
  });
});

describe("mergeOpenClawModelLists", () => {
  it("dedupes by id and keeps gateway first", () => {
    const a = [{ capabilities: { documents: false, images: false }, id: "a", name: "A" }];
    const b = [
      { capabilities: { documents: true, images: false }, id: "a", name: "Dup" },
      { capabilities: { documents: false, images: false }, id: "b", name: "B" },
    ];
    expect(mergeOpenClawModelLists(a, b)).toEqual([
      { capabilities: { documents: false, images: false }, id: "a", name: "A" },
      { capabilities: { documents: false, images: false }, id: "b", name: "B" },
    ]);
  });
});

describe("conversationToOpenAiMessages", () => {
  it("maps roles and skips empty", () => {
    expect(
      conversationToOpenAiMessages([
        { content: "Hi", parts: [{ text: "Hi", type: "text" }], role: "user" },
        { content: "", parts: [{ text: " ", type: "text" }], role: "assistant" },
        { content: "OK", parts: [{ text: "OK", type: "text" }], role: "assistant" },
      ]),
    ).toEqual([
      { content: "Hi", role: "user" },
      { content: "OK", role: "assistant" },
    ]);
  });

  it("uses content when parts is missing", () => {
    expect(
      conversationToOpenAiMessages([
        { content: "Hello", role: "user" },
        { content: "World", role: "assistant" },
      ]),
    ).toEqual([
      { content: "Hello", role: "user" },
      { content: "World", role: "assistant" },
    ]);
  });

  it("skips messages with only whitespace content", () => {
    expect(
      conversationToOpenAiMessages([
        { content: "   ", role: "user" },
        { content: "valid", role: "assistant" },
      ]),
    ).toEqual([{ content: "valid", role: "assistant" }]);
  });
});
