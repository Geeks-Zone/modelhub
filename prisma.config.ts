import "./server/env";

import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL não definido. Defina DATABASE_URL (e opcionalmente DIRECT_URL) via .env/.env.local ou variáveis de ambiente para usar Prisma com Postgres.",
  );
}

const directUrl = process.env.DIRECT_URL?.trim() || undefined;

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
    ...(directUrl ? { directUrl } : {}),
  },
});
