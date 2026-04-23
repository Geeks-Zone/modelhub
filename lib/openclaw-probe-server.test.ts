import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchOpenClawGatewayModelsFromServer,
  isOpenAiModelsListJson,
  looksLikeHtml,
  runOpenClawProbeFromServer,
} from "@/lib/openclaw-probe-server";

describe("looksLikeHtml", () => {
  it("detects text/html Content-Type", () => {
    expect(looksLikeHtml("{}", "text/html; charset=utf-8")).toBe(true);
  });

  it("detects doctype prefix without header", () => {
    expect(looksLikeHtml("<!doctype html><html>", "application/json")).toBe(true);
  });

  it("does not flag valid JSON string", () => {
    expect(looksLikeHtml('{"object":"list","data":[]}', "application/json")).toBe(false);
  });
});

describe("isOpenAiModelsListJson", () => {
  it("accepts OpenAI-style models list", () => {
    expect(
      isOpenAiModelsListJson(
        JSON.stringify({
          data: [{ id: "m1", object: "model" }],
          object: "list",
        }),
      ),
    ).toBe(true);
  });

  it("rejects missing data array", () => {
    expect(isOpenAiModelsListJson(JSON.stringify({ object: "list" }))).toBe(false);
  });

  it("rejects wrong object field", () => {
    expect(
      isOpenAiModelsListJson(JSON.stringify({ data: [], object: "not-list" })),
    ).toBe(false);
  });

  it("rejects invalid JSON", () => {
    expect(isOpenAiModelsListJson("not json")).toBe(false);
  });
});

describe("runOpenClawProbeFromServer (fetch mockado)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falha sem token", async () => {
    const result = await runOpenClawProbeFromServer({ baseUrl: "http://127.0.0.1:18789", token: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.summary).toMatch(/Token/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha com URL não-loopback (sem chamar fetch)", async () => {
    const result = await runOpenClawProbeFromServer({
      baseUrl: "https://example.com",
      token: "abc",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.codeBlocks?.length).toBeGreaterThan(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ok quando GET /v1/models devolve JSON object=list", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "openclaw/x", object: "model" }],
          object: "list",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );

    const result = await runOpenClawProbeFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "secret",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18789/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" },
        method: "GET",
      }),
    );
  });

  it("compat desactivado quando resposta é HTML (UI) com 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<!doctype html><html><title>OpenClaw</title></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 200,
      }),
    );

    const result = await runOpenClawProbeFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "secret",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.summary).toMatch(/HTML|controlo|compat/i);
      expect(result.diagnostic.codeBlocks?.some((b) => b.code.includes("chatCompletions"))).toBe(true);
    }
  });

  it("401 → diagnóstico de token", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));

    const result = await runOpenClawProbeFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "wrong",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.summary).toMatch(/401|recusou|token/i);
    }
  });

  it("403 → diagnóstico de token", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));

    const result = await runOpenClawProbeFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "wrong",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.summary).toMatch(/401|403|recusou|token/i);
    }
  });

  it("HTTP 500 → diagnóstico genérico", async () => {
    fetchMock.mockResolvedValueOnce(new Response("err", { status: 500 }));

    const result = await runOpenClawProbeFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "secret",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.summary).toContain("500");
    }
  });

  it("200 com JSON inválido para lista → compat desactivado", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ foo: 1 }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    const result = await runOpenClawProbeFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "secret",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.summary).toMatch(/HTML|controlo|compat|desactivad/i);
    }
  });

  it("ECONNREFUSED → diagnóstico de rede / servidor", async () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:18789");
    (err as NodeJS.ErrnoException).code = "ECONNREFUSED";
    fetchMock.mockRejectedValueOnce(err);

    const result = await runOpenClawProbeFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "secret",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.summary).toMatch(/Não foi possível|ligação|gateway/i);
    }
  });

  it("fetch failed (browser-like) → diagnóstico remoto/rede", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await runOpenClawProbeFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "secret",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.summary.length).toBeGreaterThan(0);
    }
  });
});

describe("fetchOpenClawGatewayModelsFromServer (fetch mockado)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("200 + JSON lista → Response 200 com body", async () => {
    const body = JSON.stringify({
      data: [{ id: "m", object: "model" }],
      object: "list",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(body, { headers: { "Content-Type": "application/json" }, status: 200 }),
    );

    const res = await fetchOpenClawGatewayModelsFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "t",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it("200 + HTML → 502 com mensagem", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<!doctype html>", { headers: { "Content-Type": "text/html" }, status: 200 }),
    );

    const res = await fetchOpenClawGatewayModelsFromServer({
      baseUrl: "http://127.0.0.1:18789",
      token: "t",
    });

    expect(res.status).toBe(502);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toBeDefined();
  });

  it("URL inválida → 400", async () => {
    const res = await fetchOpenClawGatewayModelsFromServer({
      baseUrl: "https://attacker.example",
      token: "t",
    });

    expect(res.status).toBe(400);
  });
});
