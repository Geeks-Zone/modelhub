import { createNeonAuth } from "@neondatabase/auth/next/server";

type NeonAuth = ReturnType<typeof createNeonAuth>;

let _auth: NeonAuth | undefined;

function getAuth(): NeonAuth {
  if (!_auth) {
    // Não chamar ensureRuntimeEnvValidated aqui: este módulo é avaliado pelo middleware (Edge/Turbopack),
    // onde process.env pode não refletir o .env.local como no Node. Validação em instrumentation.ts e server/lib/db.ts.
    _auth = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!,
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!,
      },
    });
  }
  return _auth;
}

/**
 * Lazy-initialized Neon Auth instance.
 * Uses a Proxy so callers can still do `auth.handler()`, `auth.getSession()`, etc.
 * The real instance is only created on first property access (at runtime, not build time).
 */
export const auth: NeonAuth = new Proxy({} as NeonAuth, {
  get(_target, prop, receiver) {
    return Reflect.get(getAuth(), prop, receiver);
  },
});
