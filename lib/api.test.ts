import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, apiJson, apiJsonRequest, testProviderCredentials } from "./api";

const originalFetch = global.fetch;

describe("api helpers", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("apiFetch aplica credentials same-origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock as typeof fetch;

    await apiFetch("/health", {
      headers: { Accept: "application/json" },
      method: "GET",
    });

    expect(fetchMock).toHaveBeenCalledWith("/health", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "GET",
    });
  });

  it("apiJson retorna payload JSON quando a resposta e valida", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 42 }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    ) as typeof fetch;

    await expect(apiJson<{ ok: boolean; value: number }>("/api/test")).resolves.toEqual({
      ok: true,
      value: 42,
    });
  });

  it("apiJson usa mensagem de erro do payload quando disponivel", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Falha detalhada" }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      }),
    ) as typeof fetch;

    await expect(apiJson("/api/test")).rejects.toThrow("Falha detalhada");
  });

  it("apiJson cai para o status HTTP quando a resposta de erro nao e JSON valido", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("oops", {
        headers: { "Content-Type": "text/plain" },
        status: 502,
      }),
    ) as typeof fetch;

    await expect(apiJson("/api/test")).rejects.toThrow("HTTP 502");
  });

  it("apiJsonRequest serializa o corpo como JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ created: true }), {
        headers: { "Content-Type": "application/json" },
        status: 201,
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(
      apiJsonRequest<{ created: boolean }>("/api/items", "POST", { name: "demo" }),
    ).resolves.toEqual({ created: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/items", {
      body: JSON.stringify({ name: "demo" }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("testProviderCredentials envia credenciais codificadas e retorna o payload do servidor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, skipped: false }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(
      testProviderCredentials("/openrouter", { OPENROUTER_API_KEY: "sk-demo" }),
    ).resolves.toEqual({ ok: true, skipped: false });

    expect(fetchMock).toHaveBeenCalledWith("/openrouter/api/test", {
      credentials: "same-origin",
      headers: {
        "x-provider-credentials": btoa(JSON.stringify({ OPENROUTER_API_KEY: "sk-demo" })),
      },
      method: "POST",
    });
  });

  it("testProviderCredentials retorna erro padrao quando o servidor responde com JSON invalido", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("not-json", {
        headers: { "Content-Type": "text/plain" },
        status: 500,
      }),
    ) as typeof fetch;

    await expect(testProviderCredentials("/openrouter", {})).resolves.toEqual({
      error: "Resposta inválida do servidor.",
      ok: false,
    });
  });
});
