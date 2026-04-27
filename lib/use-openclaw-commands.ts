import { DEFAULT_MODEL_ID } from "@/lib/defaults";

const FALLBACK_BASE_URL = "https://www.modelhub.com.br";

type OpenClawCommands = {
  apiBaseUrl: string;
  baseUrl: string;
  modelId: string;
  modelRef: string;
  run: string;
  install: string;
  model: string;
  models: (key?: string) => string;
  setup: (key?: string) => string;
  sync: (key?: string) => string;
  verify: (key?: string) => string;
};

type Options = {
  readonly apiKey?: string | null;
  readonly modelId?: string | null;
};

/**
 * Usa a origem atual no browser; fallback para o domínio público em SSR.
 * Antes a URL era fixa em "modelhub.com.br" mesmo em deploys de preview,
 * fazendo a UI imprimir comandos errados para previews/staging.
 */
function resolveBaseUrl(): string {
  if (typeof globalThis !== "undefined" && globalThis.window?.location?.origin) {
    return globalThis.window.location.origin;
  }
  return FALLBACK_BASE_URL;
}

export function useOpenClawCommands(options: Options = {}): OpenClawCommands {
  const apiKey = options.apiKey ?? "SUA_API_KEY";
  const modelId = options.modelId?.trim() || DEFAULT_MODEL_ID;
  const baseUrl = resolveBaseUrl();
  const modelRef = `modelhub/${modelId}`;
  return {
    apiBaseUrl: `${baseUrl}/v1`,
    baseUrl,
    modelId,
    modelRef,
    run: "npx @model-hub/openclaw-cli run",
    install: "npm install -g openclaw@latest",
    model: `npx @model-hub/openclaw-cli use ${modelId}`,
    models: (key?: string) =>
      `npx @model-hub/openclaw-cli models --base-url ${baseUrl} --api-key ${key ?? apiKey}`,
    setup: (key?: string) =>
      `npx @model-hub/openclaw-cli setup --base-url ${baseUrl} --api-key ${key ?? apiKey} --model ${modelId}`,
    sync: (key?: string) =>
      `npx @model-hub/openclaw-cli sync --base-url ${baseUrl} --api-key ${key ?? apiKey}`,
    verify: (key?: string) =>
      `npx @model-hub/openclaw-cli doctor --base-url ${baseUrl} --api-key ${key ?? apiKey} --model ${modelId}`,
  };
}
