import {
  diagnosticHttp,
  diagnosticUnauthorized,
  normalizeGatewayBaseUrl,
  type OpenClawGatewayDiagnostic,
  type OpenClawGatewayProbeResult,
  type OpenClawGatewaySettings,
} from "@/lib/openclaw-gateway";
import { assertLoopbackGatewayBaseUrl } from "@/lib/openclaw-loopback";

const INVALID_GATEWAY_BASE_MESSAGE = "URL base do gateway inválida ou não permitida.";
const GATEWAY_REQUEST_FAILED_MESSAGE = "Não foi possível contactar o gateway OpenClaw.";

function diagnosticOpenClawCompatDisabled(): OpenClawGatewayDiagnostic {
  return {
    codeBlocks: [
      {
        code: `openclaw dashboard`,
        title: "Painel OpenClaw no browser (token / WebSocket)",
      },
      {
        code: `Se aparecer «gateway token missing» em http://127.0.0.1:18789/chat :
- Cole no painel o MESMO valor de OPENCLAW_GATEWAY_TOKEN (campo «Token do Gateway»), ou
- Abra a URL que «openclaw dashboard» imprimir (já leva o token).

Isto autentica a UI /chat. É independente do passo seguinte (API HTTP).`,
        title: "Erro no /chat do OpenClaw ≠ erro do ModelHub",
      },
      {
        code: `{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}`,
        title: "ModelHub precisa disto: API HTTP GET /v1/models (merge em ~/.openclaw/openclaw.json)",
      },
      {
        code: `{
  "gateway": {
    "http": {
      "endpoints": {
        "responses": { "enabled": true }
      }
    }
  }
}`,
        title: "Alternativa — activar só «responses» (também expõe /v1/models)",
      },
      {
        code: `$env:OPENCLAW_GATEWAY_TOKEN="MESMO_TOKEN_QUE_NO_MODELOHUB"
openclaw gateway --port 18789`,
        title: "Depois de editar o JSON: reiniciar o gateway (PowerShell)",
      },
    ],
    steps: [
      "São duas coisas diferentes: (A) o painel em /chat usa WebSocket e pede token nos campos — veja os blocos acima; (B) o ModelHub usa só HTTP GET /v1/models com Bearer, e essa rota só existe em JSON quando chat completions ou responses está activo.",
      "Sem (B), o OpenClaw serve HTML (SPA) em /v1/models e o ModelHub mostra esta mensagem — não é porque o token no painel /chat esteja errado.",
      "Incorpore o JSON «ModelHub precisa disto» no seu openclaw.json, reinicie o gateway e use «Tentar novamente».",
    ],
    summary:
      "GET /v1/models devolveu HTML (UI) em vez de JSON — a API compatível OpenAI está desactivada no gateway. O aviso «token missing» no /chat do OpenClaw resolve-se no painel; o ModelHub ainda precisa de chatCompletions/responses activos no JSON.",
  };
}

function diagnosticRemoteServerCannotReachGateway(baseDisplay: string): OpenClawGatewayDiagnostic {
  return {
    codeBlocks: [
      {
        code: `cd caminho\\para\\modelhub
pnpm dev`,
        title: "Correr o ModelHub localmente (PowerShell)",
      },
      {
        code: `curl.exe -s -H "Authorization: Bearer SEU_TOKEN" "${baseDisplay}/v1/models"`,
        title: "Testar o gateway na sua máquina (deve ser JSON com object=list)",
      },
    ],
    steps: [
      "Se o ModelHub corre num servidor remoto (ex.: Vercel), esse servidor não consegue aceder ao 127.0.0.1 do seu PC. Use «pnpm dev» na sua máquina ou um túnel/URL público para o gateway.",
      `Se está em desenvolvimento local, confirme que o gateway escuta em ${baseDisplay} e que o token coincide com OPENCLAW_GATEWAY_TOKEN.`,
    ],
    summary: "Não foi possível estabelecer ligação ao gateway a partir do servidor do ModelHub.",
  };
}

/** Resposta GET /v1/models no formato OpenAI (lista de modelos). */
export function isOpenAiModelsListJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { data?: unknown; object?: string };
    return parsed.object === "list" && Array.isArray(parsed.data);
  } catch {
    return false;
  }
}

/** UI de controlo ou SPA em vez da API (OpenClaw sem chatCompletions/responses activos). */
export function looksLikeHtml(text: string, contentType: string | null): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html")) {
    return true;
  }
  const head = text.slice(0, 256).trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

/**
 * Executa o probe no servidor (evita CORS no browser) com validação de JSON real.
 */
export async function runOpenClawProbeFromServer(input: {
  baseUrl: string;
  token: string;
}): Promise<OpenClawGatewayProbeResult> {
  const token = input.token.trim();
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

  let baseDisplay: string;
  try {
    baseDisplay = assertLoopbackGatewayBaseUrl(input.baseUrl);
  } catch {
    return {
      diagnostic: {
        codeBlocks: [
          {
            code: `http://127.0.0.1:18789
http://localhost:18789
http://[::1]:18789`,
            title: "URLs aceites pelo proxy do ModelHub (sem hosts públicos)",
          },
        ],
        steps: [`Ajuste o URL base do gateway (apenas 127.0.0.1, localhost ou ::1).`],
        summary: INVALID_GATEWAY_BASE_MESSAGE,
      },
      ok: false,
    };
  }

  const base = normalizeGatewayBaseUrl(baseDisplay);

  try {
    const res = await fetch(`${base}/v1/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: "GET",
    });

    const text = await res.text();
    const contentType = res.headers.get("content-type");

    if (res.status === 401 || res.status === 403) {
      return { diagnostic: diagnosticUnauthorized(), ok: false };
    }

    if (!res.ok) {
      return { diagnostic: diagnosticHttp(res.status), ok: false };
    }

    if (looksLikeHtml(text, contentType) || !isOpenAiModelsListJson(text)) {
      return { diagnostic: diagnosticOpenClawCompatDisabled(), ok: false };
    }

    return { ok: true };
  } catch (error) {
    console.error("OpenClaw probe failed:", error);
    const message = error instanceof Error ? error.message : "";
    const lower = message.toLowerCase();
    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("etimedout") ||
      lower.includes("fetch failed") ||
      lower.includes("networkerror")
    ) {
      return { diagnostic: diagnosticRemoteServerCannotReachGateway(baseDisplay), ok: false };
    }
    return {
      diagnostic: {
        steps: [diagnosticRemoteServerCannotReachGateway(baseDisplay).steps[1] ?? ""].filter(Boolean),
        summary: GATEWAY_REQUEST_FAILED_MESSAGE,
      },
      ok: false,
    };
  }
}

/** Para rotas API: valida loopback e obtém JSON da lista de modelos. */
export async function fetchOpenClawGatewayModelsFromServer(settings: OpenClawGatewaySettings): Promise<Response> {
  let baseDisplay: string;
  try {
    baseDisplay = assertLoopbackGatewayBaseUrl(settings.baseUrl);
  } catch {
    return new Response(JSON.stringify({ error: INVALID_GATEWAY_BASE_MESSAGE }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }

  const token = settings.token.trim();
  const base = normalizeGatewayBaseUrl(baseDisplay);

  try {
    const res = await fetch(`${base}/v1/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      method: "GET",
    });

    const text = await res.text();
    const contentType = res.headers.get("content-type");

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: `HTTP ${res.status}`,
        }),
        { headers: { "Content-Type": "application/json" }, status: res.status },
      );
    }

    if (looksLikeHtml(text, contentType) || !isOpenAiModelsListJson(text)) {
      return new Response(
        JSON.stringify({
          error: diagnosticOpenClawCompatDisabled().summary,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(text, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      status: 200,
    });
  } catch (error) {
    console.error("OpenClaw model fetch failed:", error);
    return new Response(JSON.stringify({ error: GATEWAY_REQUEST_FAILED_MESSAGE }), {
      headers: { "Content-Type": "application/json" },
      status: 502,
    });
  }
}
