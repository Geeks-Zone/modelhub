/**
 * Prisma client singleton for the API process.
 */

import "../env";
import { ensureRuntimeEnvValidated } from "../env";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../../generated/prisma/client.ts";

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as {
  __prisma?: PrismaClientInstance;
};

function createPrismaClient(): PrismaClientInstance {
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

function getPrismaClient(): PrismaClientInstance {
  if (!globalForPrisma.__prisma) {
    globalForPrisma.__prisma = createPrismaClient();
  }

  return globalForPrisma.__prisma;
}

/**
 * Lazy Prisma proxy to avoid touching DATABASE_URL during Next.js build-time module evaluation.
 */
export const prisma: PrismaClientInstance = new Proxy({} as PrismaClientInstance, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrismaClient(), prop, receiver);
  },
});
