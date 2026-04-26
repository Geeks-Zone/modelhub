import { apiFetch, apiJson } from "@/lib/api";
import type { ProviderCredentialSummary, ProviderModel, UiProvider } from "@/lib/contracts";
import { providerHasRequiredCredentials } from "@/lib/provider-credentials";

import { buildModelhubOpenClawModelId } from "./conversation-mapping";
import {
  OPENCLAW_PROVIDER_ID,
  type OpenClawGatewaySettings,
  normalizeGatewayBaseUrl,
} from "./gateway-settings";

export type OpenClawDiagnosticCodeBlock = {
  title: string;
  code: string;
};

export type OpenClawGatewayDiagnostic = {
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
        title: "PowerShell - iniciar gateway",
      },
      {
        code: curlProbe,
        title: "Teste rapido - deve devolver JSON",
      },
    ],
    steps: [
      `Confirme que o gateway esta em execucao no PC.`,
      `Verifique se a URL base corresponde ao gateway (${baseDisplay}) e se a porta esta aberta.`,
      `A verificacao roda no servidor do ModelHub; em producao ele nao alcanca o 127.0.0.1 do seu PC sem tunnel.`,
    ],
    summary: `Nao foi possivel contactar o gateway em ${baseDisplay}.`,
  };
}

export function diagnosticUnauthorized(): OpenClawGatewayDiagnostic {
  return {
    codeBlocks: [
      {
        code: `$env:OPENCLAW_GATEWAY_TOKEN="COLE_AQUI_O_MESMO_TOKEN_DO_MODELOHUB"
openclaw gateway --port 18789`,
        title: "PowerShell - token identico ao campo Token do ModelHub",
      },
    ],
    steps: [
      `O valor de OPENCLAW_GATEWAY_TOKEN no terminal deve ser exatamente o mesmo do campo Token no ModelHub.`,
      `Reinicie o gateway depois de alterar o token.`,
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
        title: "Terminal - diagnostico OpenClaw",
      },
    ],
    steps: [
      `Confira openclaw gateway status ou openclaw doctor no terminal.`,
      `Atualize o OpenClaw CLI se a versao for antiga.`,
    ],
    summary: `O gateway respondeu com HTTP ${status}.`,
  };
}

export async function probeOpenClawGateway(settings: OpenClawGatewaySettings): Promise<OpenClawGatewayProbeResult> {
  const token = settings.token.trim();
  if (!token) {
    return {
      diagnostic: {
        codeBlocks: [
          {
            code: `$env:OPENCLAW_GATEWAY_TOKEN="gere_ou_cole_um_token_longo"
openclaw gateway --port 18789`,
            title: "PowerShell - exemplo",
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
          steps: [`Resposta invalida do servidor do ModelHub ao verificar o gateway.`],
          summary: "Resposta invalida.",
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
        steps: [`Tente novamente ou atualize a pagina.`],
        summary: `Falha ao interpretar a verificacao (HTTP ${res.status}).`,
      },
      ok: false,
    };
  } catch (error) {
    const isTypeError = error instanceof TypeError;
    const message = isTypeError ? error.message : String(error);
    if (isTypeError && (message.includes("fetch") || message.includes("Failed to fetch") || message.includes("NetworkError"))) {
      return { diagnostic: diagnosticNetwork(base), ok: false };
    }
    return {
      diagnostic: {
        steps: [
          `Confirme URL, token e que o processo do gateway esta ativo.`,
          diagnosticNetwork(base).steps[2] ?? "",
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

export async function fetchOpenClawGatewayModelsOrEmpty(params: {
  baseUrl: string;
  token: string;
}): Promise<ProviderModel[]> {
  try {
    return await fetchOpenClawGatewayModels(params);
  } catch (error) {
    console.warn(
      "[openclaw-gateway] failed to fetch models:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

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
        name: `${m.name} - ${provider.label}`,
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

export async function probeOpenClawBridge(baseUrl: string): Promise<{
  bridge: { port: number; status: string };
  gateway: { base: string; models: number; ok: boolean };
  model: { primary: string | null };
} | null> {
  const base = normalizeGatewayBaseUrl(baseUrl);
  try {
    const res = await fetch(`${base}/api/status`, { method: "GET", mode: "cors" });
    if (!res.ok) {
      console.debug(`[openclaw-bridge] HTTP ${res.status} from ${base}/api/status`);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.debug(
      "[openclaw-bridge] not reachable:",
      base,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

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

export async function setBridgeModel(
  baseUrl: string,
  modelRef: string,
  token?: string,
): Promise<{ ok: boolean; model?: string; error?: string }> {
  const base = normalizeGatewayBaseUrl(baseUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  try {
    const res = await fetch(`${base}/api/model`, {
      body: JSON.stringify({ model: modelRef }),
      headers,
      method: "POST",
    });
    return await res.json();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
