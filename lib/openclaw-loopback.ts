import { normalizeGatewayBaseUrl } from "@/lib/openclaw-gateway";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Só permite URLs de gateway local (loopback) para evitar SSRF no proxy API.
 * @throws Error se o host não for seguro
 */
export function assertLoopbackGatewayBaseUrl(raw: string): string {
  const base = normalizeGatewayBaseUrl(raw);
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("URL do gateway inválida.");
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("O gateway local deve usar http ou https.");
  }

  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      "Por segurança, o proxy só aceita gateway em 127.0.0.1, localhost ou ::1. Use um túnel se precisar de outro host.",
    );
  }

  return base;
}
