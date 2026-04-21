/**
 * Carrega .env / .env.local para CLI (Prisma, scripts). O app Next.js já injeta env em runtime.
 */
for (const envFile of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Ignorado quando não disponível (ex.: Edge) ou arquivo ausente.
  }
}
