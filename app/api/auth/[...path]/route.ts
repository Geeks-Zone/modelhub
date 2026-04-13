import { auth } from "@/lib/auth/server";

const authHandlers = auth.handler();

function getNeonAuthCanonicalOrigin(): string | null {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

function withCanonicalAuthOrigin(request: Request): Request {
  const canonicalOrigin = getNeonAuthCanonicalOrigin();
  if (!canonicalOrigin) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set("origin", canonicalOrigin);
  headers.set("referer", `${canonicalOrigin}/`);

  Object.defineProperty(request, "headers", {
    configurable: true,
    enumerable: true,
    value: headers,
  });

  return request;
}

type AuthRouteContext = {
  params: Promise<{ path: string[] }>;
};

export function GET(request: Request, context: AuthRouteContext): Promise<Response> {
  return authHandlers.GET(withCanonicalAuthOrigin(request), context);
}

export function POST(request: Request, context: AuthRouteContext): Promise<Response> {
  return authHandlers.POST(withCanonicalAuthOrigin(request), context);
}
