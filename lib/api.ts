export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.headers ?? {}),
    },
  });
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        errorMessage = payload.error;
      }
    } catch {
      // Keep fallback status message.
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

export async function apiJsonRequest<TResponse>(
  input: RequestInfo | URL,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<TResponse> {
  return apiJson<TResponse>(input, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method,
  });
}

/**
 * Test provider credentials by calling POST /{base}/api/test with credentials
 * encoded in the x-provider-credentials header.
 * Returns { ok, error?, skipped? }.
 */
export async function testProviderCredentials(
  providerBase: string,
  credentials: Record<string, string>,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const encoded = btoa(JSON.stringify(credentials));
  const response = await apiFetch(`${providerBase}/api/test`, {
    method: "POST",
    headers: {
      "x-provider-credentials": encoded,
    },
  });

  const json = (await response.json().catch(() => ({ ok: false, error: "Resposta inválida do servidor." }))) as {
    ok: boolean;
    error?: string;
    skipped?: boolean;
  };

  return json;
}
