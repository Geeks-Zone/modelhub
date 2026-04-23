type OpenClawProxyBody = {
  baseUrl: string;
  payload?: unknown;
  token: string;
};

type OpenClawProxyParseResult =
  | { body: OpenClawProxyBody; error: null }
  | { body: null; error: Response };

export async function parseOpenClawProxyBody(request: Request): Promise<OpenClawProxyParseResult> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      body: null,
      error: new Response(JSON.stringify({ error: { message: "Corpo JSON inválido." } }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      }),
    };
  }

  const parsed = raw as { baseUrl?: unknown; token?: unknown; payload?: unknown };
  const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl : "";
  const token = typeof parsed.token === "string" ? parsed.token : "";
  const payload = parsed.payload;

  return { body: { baseUrl, token, payload }, error: null };
}