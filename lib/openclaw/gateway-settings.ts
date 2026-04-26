const OPENCLAW_GATEWAY_STORAGE_BASE = "openclaw-gateway-base-url";
const OPENCLAW_GATEWAY_STORAGE_TOKEN = "openclaw-gateway-token";
const OPENCLAW_BRIDGE_STORAGE_BASE = "openclaw-bridge-base-url";
const OPENCLAW_BRIDGE_STORAGE_TOKEN = "openclaw-bridge-token";
const OPENCLAW_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const OPENCLAW_DEFAULT_BASE = "http://127.0.0.1:18789";
export const OPENCLAW_DEFAULT_BRIDGE = "http://127.0.0.1:18790";
export const OPENCLAW_PROVIDER_ID = "openclaw";

export type OpenClawMode = "bridge" | "gateway";

export type OpenClawGatewaySettings = {
  baseUrl: string;
  token: string;
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

export function hasOpenClawGatewayToken(settings: OpenClawGatewaySettings): boolean {
  return settings.token.trim().length > 0;
}

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

export function generateSuggestedGatewayToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
