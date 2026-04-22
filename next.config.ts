import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lê uma chave de .env.local / .env antes do Next aplicar dotenv, para que possamos
 * repassar variáveis ao runtime Edge (middleware) via `env` abaixo.
 */
function readEnvFile(key: string): string | undefined {
  const root = process.cwd();
  for (const name of [".env.local", ".env"]) {
    const filePath = join(root, name);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      if (k !== key) continue;
      let v = trimmed.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  return undefined;
}

// CI / Vercel: variáveis já vêm em process.env. Local: next.config corre antes do merge do dotenv.
const neonAuthBaseUrl =
  process.env.NEON_AUTH_BASE_URL ?? readEnvFile("NEON_AUTH_BASE_URL") ?? "";
const neonAuthCookieSecret =
  process.env.NEON_AUTH_COOKIE_SECRET ?? readEnvFile("NEON_AUTH_COOKIE_SECRET") ?? "";

const nextConfig: NextConfig = {
  env: {
    // Necessário para o middleware (Edge) ver o mesmo segredo/base URL que o Node lê do .env.local.
    // Não use NEXT_PUBLIC_* — não expõe ao browser por si só; evite referenciar estes nomes em Client Components.
    NEON_AUTH_BASE_URL: neonAuthBaseUrl,
    NEON_AUTH_COOKIE_SECRET: neonAuthCookieSecret,
  },
  serverExternalPackages: ["jsdom"],
  reactCompiler: true,
  transpilePackages: ["html-encoding-sniffer", "@exodus/bytes"],
};

export default nextConfig;
