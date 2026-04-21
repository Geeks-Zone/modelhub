/**
 * Valida variáveis de ambiente no processo Node ao subir o servidor.
 * Import dinâmico evita puxar `server/env` (e o catálogo de providers) para o bundle Edge Instrumentation.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  const { ensureRuntimeEnvValidated } = await import("@/server/env");
  ensureRuntimeEnvValidated();
}
