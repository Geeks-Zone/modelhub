import "./server/load-env-files";

import { defineConfig } from "prisma/config";

function isPrismaGenerateCommand(argv: string[]): boolean {
  return argv.some((arg) => /\bgenerate\b/.test(arg));
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl && !isPrismaGenerateCommand(process.argv)) {
  throw new Error(
    "DATABASE_URL não definido. Defina DATABASE_URL (e opcionalmente DIRECT_URL) via .env/.env.local ou variáveis de ambiente para usar Prisma com Postgres.",
  );
}

const directUrl = process.env.DIRECT_URL?.trim() || undefined;
const fallbackDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/modelhub";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // `prisma generate` só precisa de uma URL sintaticamente válida para montar o client.
    url: databaseUrl || fallbackDatabaseUrl,
    ...(directUrl ? { directUrl } : {}),
  },
});
