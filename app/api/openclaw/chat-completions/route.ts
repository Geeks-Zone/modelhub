import { normalizeGatewayBaseUrl } from "@/lib/openclaw-gateway";
import { assertLoopbackGatewayBaseUrl } from "@/lib/openclaw-loopback";
import { parseOpenClawProxyBody } from "@/lib/openclaw-proxy-body";

export async function POST(request: Request) {
  const { body, error: parseError } = await parseOpenClawProxyBody(request);
  if (parseError) return parseError;

  const { baseUrl, token, payload } = body;

  if (!baseUrl || !token || payload === undefined || payload === null || typeof payload !== "object") {
    return new Response(JSON.stringify({ error: { message: "Parâmetros baseUrl, token e payload são obrigatórios." } }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }

  let base: string;
  try {
    base = normalizeGatewayBaseUrl(assertLoopbackGatewayBaseUrl(baseUrl));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: { message: msg } }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }

  try {
    const upstream = await fetch(`${base}/v1/chat/completions`, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: request.signal,
    });

    const contentType = upstream.headers.get("content-type") ?? "application/json";

    return new Response(upstream.body, {
      headers: { "Content-Type": contentType },
      status: upstream.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: { message } }), {
      headers: { "Content-Type": "application/json" },
      status: 502,
    });
  }
}