/**
 * Prisma client singleton for the API process.
 */

import "../env";
import { ensureRuntimeEnvValidated } from "../env";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../../generated/prisma/client.ts";

const globalForPrisma = globalThis as {
  __prisma?: InstanceType<typeof PrismaClient>;
};

function createPrismaClient(): InstanceType<typeof PrismaClient> {
  ensureRuntimeEnvValidated();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL não definido");
  }

  // Use the DATABASE_URL as-is (preserving sslmode=require & channel_binding=require from Neon).
  // Pass ssl: true so node-postgres enables TLS without requiring CA certificates locally.
  const pool = new Pool({ connectionString: databaseUrl, ssl: true });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}
