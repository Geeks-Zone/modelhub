import { createNeonAuth } from "@neondatabase/auth/next/server";
import { ensureRuntimeEnvValidated } from "@/server/env";

type NeonAuth = ReturnType<typeof createNeonAuth>;

let _auth: NeonAuth | undefined;

function getAuth(): NeonAuth {
  if (!_auth) {
    ensureRuntimeEnvValidated();
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
