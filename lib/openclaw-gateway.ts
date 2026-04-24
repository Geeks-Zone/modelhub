import { apiFetch, apiJson } from "@/lib/api";
import { extractPlainTextFromParts, type ConversationMessagePart, type HydratedConversationMessagePart } from "@/lib/chat-parts";
import type { ProviderCredentialSummary, ProviderModel, UiProvider } from "@/lib/contracts";
import { providerHasRequiredCredentials } from "@/lib/provider-credentials";

const OPENCLAW_GATEWAY_STORAGE_BASE = "openclaw-gateway-base-url";
const OPENCLAW_GATEWAY_STORAGE_TOKEN = "openclaw-gateway-token";
const OPENCLAW_BRIDGE_STORAGE_BASE = "openclaw-bridge-base-url";
const OPENCLAW_BRIDGE_STORAGE_TOKEN = "openclaw-bridge-token";
export const OPENCLAW_DEFAULT_BASE = "http://127.0.0.1:18789";
export const OPENCLAW_DEFAULT_BRIDGE = "http://127.0.0.1:18790";
export const OPENCLAW_PROVIDER_ID = "openclaw";
const OPENCLAW_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export type OpenClawMode = "bridge" | "gateway";

export type OpenClawGatewaySettings = {
  baseUrl: string;
  token: string;
};

type ConversationLike = {
  content?: string;
  parts?: ConversationMessagePart[] | HydratedConversationMessagePart[];
  role: "assistant" | "user";
};

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

function stripTrailingV1(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith("/v1/")) {
    return value.slice(0, -4);
  }
  if (lower.endsWith("/v1")) {
    return value.slice(0, -3);
  }
  return value;
}

export function loadOpenClawGatewaySettings(): OpenClawGatewaySettings {
  if (typeof window === "undefined") {
    return { baseUrl: OPENCLAW_DEFAULT_BASE, token: "" };
  }

  return {
    baseUrl: localStorage.getItem(OPENCLAW_GATEWAY_STORAGE_BASE)?.trim() || OPENCLAW_DEFAULT_BASE,
    token: localStorage.getItem(OPENCLAW_GATEWAY_STORAGE_TOKEN)?.trim() ?? "",
  };
}

export function saveOpenClawGatewaySettings(settings: OpenClawGatewaySettings): void {
  const base = normalizeGatewayBaseUrl(settings.baseUrl);
  localStorage.setItem(OPENCLAW_GATEWAY_STORAGE_BASE, base);
  localStorage.setItem(OPENCLAW_GATEWAY_STORAGE_TOKEN, settings.token.trim());
}

export function clearOpenClawGatewaySettings(): void {
  localStorage.removeItem(OPENCLAW_GATEWAY_STORAGE_BASE);
  localStorage.removeItem(OPENCLAW_GATEWAY_STORAGE_TOKEN);
}

/** Remove trailing slashes and optional /v1 suffix; ensure scheme. */
export function normalizeGatewayBaseUrl(raw: string): string {
  let u = trimTrailingSlashes(raw.trim());
  if (!u) {
    return OPENCLAW_DEFAULT_BASE;
  }

  if (!/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }

  return stripTrailingV1(u);
}

/** Só indica que há token guardado — não confirma que o gateway responde. Use `probeOpenClawGateway`. */
export function hasOpenClawGatewayToken(settings: OpenClawGatewaySettings): boolean {
  return settings.token.trim().length > 0;
}

/**
 * URL do painel OpenClaw com token no fragmento (igual ao `openclaw dashboard`).
 * Abre o chat nativo / WebSocket no browser; não substitui o fluxo HTTP do ModelHub.
 * @returns `null` se não houver token.
 */
export function buildOpenClawDashboardUrl(settings: OpenClawGatewaySettings): string | null {
  const token = settings.token.trim();
  if (!token) {
    return null;
  }
  try {
    const url = new URL(normalizeGatewayBaseUrl(settings.baseUrl));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (!OPENCLAW_LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }
    url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    url.search = "";
    url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
  } catch {
    return null;
  }
}

/** Bloco opcional com código pronto a colar (JSON, PowerShell, curl, etc.). */
export type OpenClawDiagnosticCodeBlock = {
  /** Rótulo curto (ex.: «Merge em openclaw.json»). */
  title: string;
  code: string;
};

export type OpenClawGatewayDiagnostic = {
  /** Snippets copiáveis para corrigir o problema sem abrir outra doc. */
  codeBlocks?: OpenClawDiagnosticCodeBlock[];
  steps: string[];
  summary: string;
};

export type OpenClawGatewayProbeResult =
  | { diagnostic: OpenClawGatewayDiagnostic; ok: false }
  | { ok: true };

function diagnosticNetwork(baseDisplay: string): OpenClawGatewayDiagnostic {
  const curlProbe = `curl.exe -s -H "Authorization: Bearer SEU_TOKEN_AQUI" "${baseDisplay}/v1/models"`;
  return {
    codeBlocks: [
      {
        code: `$env:OPENCLAW_GATEWAY_TOKEN="SEU_TOKEN_AQUI"
openclaw gateway --port 18789`,
        title: "PowerShell — iniciar gateway (mesmo token que no ModelHub)",
      },
      {
        code: curlProbe,
        title: "Teste rápido (PowerShell) — deve devolver JSON, não HTML",
      },
    ],
    steps: [
      `Confirme que o gateway está em execução no PC (ex.: PowerShell: após definir OPENCLAW_GATEWAY_TOKEN, execute openclaw gateway --port 18789).`,
      `Verifique se a URL base corresponde ao gateway (${baseDisplay}) e se a porta está aberta (firewall).`,
      `A verificação corre no servidor do ModelHub (evita CORS). Se usa o site em produção, o servidor não alcança o 127.0.0.1 do seu PC — use «pnpm dev» na sua máquina ou um túnel.`,
    ],
    summary: `Não foi possível contactar o gateway em ${baseDisplay}.`,
  };
}

export function diagnosticUnauthorized(): OpenClawGatewayDiagnostic {
  return {
    codeBlocks: [
      {
        code: `$env:OPENCLAW_GATEWAY_TOKEN="COLE_AQUI_O_MESMO_TOKEN_DO_MODELOHUB"
openclaw gateway --port 18789`,
        title: "PowerShell — token idêntico ao campo «Token» do ModelHub",
      },
    ],
    steps: [
      `O valor de OPENCLAW_GATEWAY_TOKEN no terminal deve ser exatamente o mesmo do campo "Token" no ModelHub.`,
      `Reinicie o gateway depois de alterar o token. Use "Copiar comando" no diálogo de configuração para alinhar variável e token.`,
    ],
    summary: "O gateway recusou o token (401/403).",
  };
}

export function diagnosticHttp(status: number): OpenClawGatewayDiagnostic {
  return {
    codeBlocks: [
      {
        code: `openclaw gateway status
openclaw doctor`,
        title: "Terminal — diagnóstico OpenClaw",
      },
    ],
    steps: [
      `Confira openclaw gateway status ou openclaw doctor no terminal.`,
      `Atualize o OpenClaw CLI se a versão for antiga.`,
    ],
    summary: `O gateway respondeu com HTTP ${status}.`,
  };
}

/**
 * Verifica se o gateway OpenClaw local aceita o token e expõe /v1/models (JSON OpenAI).
 * Usa POST /api/openclaw/probe no servidor para evitar CORS e para rejeitar respostas HTML da UI.
 */
export async function probeOpenClawGateway(settings: OpenClawGatewaySettings): Promise<OpenClawGatewayProbeResult> {
  const token = settings.token.trim();
  if (!token) {
    return {
      diagnostic: {
        codeBlocks: [
          {
            code: `$env:OPENCLAW_GATEWAY_TOKEN="gere_ou_cole_um_token_longo"
openclaw gateway --port 18789`,
            title: "PowerShell — exemplo (substitua o token)",
          },
        ],
        steps: [
          `Gere ou copie um token, use o mesmo no terminal (OPENCLAW_GATEWAY_TOKEN) e no campo Token aqui.`,
        ],
        summary: "Token em falta.",
      },
      ok: false,
    };
  }

  const base = normalizeGatewayBaseUrl(settings.baseUrl);
  const baseDisplay = base;

  try {
    const res = await apiFetch("/api/openclaw/probe", {
      body: JSON.stringify({ baseUrl: base, token }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      return {
        diagnostic: {
          steps: [`Resposta inválida do servidor do ModelHub ao verificar o gateway.`],
          summary: "Resposta inválida.",
        },
        ok: false,
      };
    }

    const result = parsed as OpenClawGatewayProbeResult;
    if (result.ok) {
      return { ok: true };
    }

    if ("diagnostic" in result && result.diagnostic) {
      return result;
    }

    return {
      diagnostic: {
        steps: [`Tente novamente ou actualize a página.`],
        summary: `Falha ao interpretar a verificação (HTTP ${res.status}).`,
      },
      ok: false,
    };
  } catch (error) {
    const isTypeError = error instanceof TypeError;
    const message = isTypeError ? error.message : String(error);
    if (isTypeError && (message.includes("fetch") || message.includes("Failed to fetch") || message.includes("NetworkError"))) {
      return { diagnostic: diagnosticNetwork(baseDisplay), ok: false };
    }
    return {
      diagnostic: {
        steps: [
          `Confirme URL, token e que o processo do gateway está ativo.`,
          diagnosticNetwork(baseDisplay).steps[2] ?? "",
        ].filter(Boolean),
        summary: `Erro ao contactar o gateway: ${message}`,
      },
      ok: false,
    };
  }
}

type OpenAiModelItem = {
  id?: string;
  name?: string;
  metadata?: {
    context_window?: number;
    max_tokens?: number;
    input?: string[];
    output?: string[];
    reasoning?: boolean;
    tools?: boolean;
  };
};

async function fetchOpenClawGatewayModels(params: {
  baseUrl: string;
  token: string;
}): Promise<ProviderModel[]> {
  const base = normalizeGatewayBaseUrl(params.baseUrl);
  const res = await apiFetch("/api/openclaw/models", {
    body: JSON.stringify({
      baseUrl: base,
      token: params.token.trim(),
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } | string };
      if (typeof err.error === "string") {
        detail = err.error;
      } else if (err.error && typeof err.error === "object" && err.error.message) {
        detail = err.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  const data = (await res.json()) as { data?: OpenAiModelItem[] };
  const list = data.data ?? [];
  return list.map((m) => ({
    capabilities: {
      documents: m.metadata?.input?.includes("document") ?? false,
      images: m.metadata?.input?.includes("image") ?? false,
    },
    id: m.id ?? "unknown",
    name: m.name ?? m.id ?? "Modelo",
  }));
}

/**
 * Referência que o OpenClaw usa quando o provider `modelhub` foi configurado (`openclaw-cli setup`).
 * @see packages/openclaw-cli/README.md
 */
export function buildModelhubOpenClawModelId(providerId: string, modelId: string): string {
  return `modelhub/${providerId}/${modelId}`;
}

/** Gateway indisponível ou erro de rede → lista vazia em vez de falhar o chat inteiro. */
export async function fetchOpenClawGatewayModelsOrEmpty(params: {
  baseUrl: string;
  token: string;
}): Promise<ProviderModel[]> {
  try {
    return await fetchOpenClawGatewayModels(params);
  } catch {
    return [];
  }
}

/**
 * Modelos expostos pelo ModelHub (provedores sem chave + com credenciais salvas), no formato esperado pelo OpenClaw
 * quando o catálogo `modelhub` está no `~/.openclaw/openclaw.json`.
 */
export async function fetchModelhubCatalogModelsForOpenClaw(input: {
  credentials: ProviderCredentialSummary[];
  providers: UiProvider[];
}): Promise<ProviderModel[]> {
  const eligible = input.providers.filter(
    (p) =>
      p.id !== OPENCLAW_PROVIDER_ID &&
      p.hasModels &&
      (!(p.requiredKeys?.length ?? 0) || providerHasRequiredCredentials(p, input.credentials)),
  );

  const settled = await Promise.allSettled(
    eligible.map(async (provider) => {
      const payload = await apiJson<{ models: ProviderModel[] }>(`${provider.base}/api/models`);
      return (payload.models ?? []).map((m) => ({
        capabilities: m.capabilities,
        id: buildModelhubOpenClawModelId(provider.id, m.id),
        name: `${m.name} · ${provider.label}`,
      }));
    }),
  );

  const out: ProviderModel[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") {
      out.push(...s.value);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Junta modelos nativos do gateway OpenClaw com referências `modelhub/...` do catálogo (sem duplicar id). */
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

/** Map internal conversation to OpenAI chat messages (text only). */
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

export function generateSuggestedGatewayToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function loadOpenClawBridgeSettings(): OpenClawGatewaySettings {
  if (typeof window === "undefined") {
    return { baseUrl: OPENCLAW_DEFAULT_BRIDGE, token: "" };
  }
  return {
    baseUrl: localStorage.getItem(OPENCLAW_BRIDGE_STORAGE_BASE)?.trim() || OPENCLAW_DEFAULT_BRIDGE,
    token: localStorage.getItem(OPENCLAW_BRIDGE_STORAGE_TOKEN)?.trim() ?? "",
  };
}

export function saveOpenClawBridgeSettings(settings: OpenClawGatewaySettings): void {
  localStorage.setItem(OPENCLAW_BRIDGE_STORAGE_BASE, normalizeGatewayBaseUrl(settings.baseUrl));
  localStorage.setItem(OPENCLAW_BRIDGE_STORAGE_TOKEN, settings.token.trim());
}

/** Probe the bridge server at /api/status. Returns the parsed status or null on failure. */
export async function probeOpenClawBridge(baseUrl: string): Promise<{
  bridge: { port: number; status: string };
  gateway: { base: string; models: number; ok: boolean };
  model: { primary: string | null };
} | null> {
  const base = normalizeGatewayBaseUrl(baseUrl);
  try {
    const res = await fetch(`${base}/api/status`, { method: "GET", mode: "cors" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    console.debug("[openclaw-bridge] not reachable:", base);
    return null;
  }
}

/** Fetch models from the bridge's /v1/models endpoint. */
export async function fetchOpenClawBridgeModels(baseUrl: string, token?: string): Promise<ProviderModel[]> {
  const base = normalizeGatewayBaseUrl(baseUrl);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const richRes = await fetch(`${base}/api/models`, { headers });
    if (richRes.ok) {
      const richData = (await richRes.json()) as { models?: Array<{ id?: string; name?: string }> };
      const list = richData.models ?? [];
      return list.map((m) => ({
        capabilities: { documents: false, images: false },
        id: m.id ?? "unknown",
        name: m.name ?? m.id ?? "Modelo",
      }));
    }

    const res = await fetch(`${base}/v1/models`, { headers });
    if (!res.ok) return [];

    const data = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const list = data.data ?? [];
    return list.map((m) => ({
      capabilities: { documents: false, images: false },
      id: m.id ?? "unknown",
      name: m.name ?? m.id ?? "Modelo",
    }));
  } catch {
    return [];
  }
}

/** Change the primary model via the bridge. */
export async function setBridgeModel(baseUrl: string, modelRef: string): Promise<{ ok: boolean; model?: string; error?: string }> {
  const base = normalizeGatewayBaseUrl(baseUrl);
  try {
    const res = await fetch(`${base}/api/model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelRef }),
    });
    return await res.json();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
