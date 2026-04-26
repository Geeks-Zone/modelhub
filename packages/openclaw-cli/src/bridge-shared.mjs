/**
 * Utilidades compartilhadas pelo bridge HTTP e pelo BridgeWSServer:
 * - allowlist de Origin (única fonte de verdade)
 * - cabeçalhos CORS
 * - extração de Bearer token
 * - requestJson contra o backend ModelHub
 * - probe HTTP do gateway local
 * - normalização "modelhub/" para refs de modelo
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.modelhub.com.br',
  'https://modelhub.com.br',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export function getAllowedOrigins() {
  const extra = (process.env.MODELHUB_BRIDGE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

export function isOriginAllowed(origin) {
  if (!origin) {
    return false;
  }
  if (getAllowedOrigins().has(origin)) {
    return true;
  }
  try {
    const url = new URL(origin);
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

/** Extrai o Bearer token de um cabeçalho `authorization`. Retorna '' se ausente. */
export function extractBearerToken(authHeader) {
  if (typeof authHeader !== 'string' || !authHeader) {
    return '';
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : '';
}

/**
 * Compara dois tokens em tempo constante. Usa tipagem byte-a-byte para evitar
 * timing attacks; cai em comparacao curta se um dos lados for vazio.
 */
export function timingSafeEqualToken(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

export function ensureModelHubPrefix(modelRef) {
  const normalized = String(modelRef || '').trim();
  if (!normalized) return normalized;
  return normalized.startsWith('modelhub/') ? normalized : `modelhub/${normalized}`;
}

export async function requestJson(serviceBaseUrl, route, options = {}) {
  const headers = { 'content-type': 'application/json' };
  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  const response = await fetch(`${serviceBaseUrl}${route}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers,
    method: options.method ?? 'GET',
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload, status: response.status };
}

const GATEWAY_PROBE_TIMEOUT_MS = 3000;

export async function probeGatewayHttp(gatewayPort, { timeoutMs = GATEWAY_PROBE_TIMEOUT_MS } = {}) {
  for (const route of ['/ready', '/readyz', '/health']) {
    try {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}${route}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        continue;
      }
      const payload = await res.json().catch(() => null);
      if (route === '/ready' || route === '/readyz') {
        if (payload?.ready === true) return true;
        continue;
      }
      if (payload?.ok === true || payload?.status === 'ok' || payload?.status === 'live') {
        return true;
      }
    } catch {
      // continue probing
    }
  }
  return false;
}
