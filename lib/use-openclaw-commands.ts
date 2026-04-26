import { DEFAULT_MODEL_ID } from "@/lib/defaults";

const FALLBACK_BASE_URL = "https://www.modelhub.com.br";

type OpenClawCommands = {
  apiBaseUrl: string;
  baseUrl: string;
  run: string;
  install: string;
  model: string;
  modelRef: string;
  models: (key?: string) => string;
  setup: (key?: string) => string;
  sync: (key?: string) => string;
  verify: (key?: string) => string;
};

/**
 * Usa a origem atual no browser; fallback para o dominio publico em SSR.
 * Antes a URL era fixa em "modelhub.com.br" mesmo em deploys de preview,
 * fazendo a UI imprimir comandos errados para previews/staging.
 */
function resolveBaseUrl(): string {
  if (typeof globalThis !== "undefined" && globalThis.window?.location?.origin) {
    return globalThis.window.location.origin;
  }
  return FALLBACK_BASE_URL;
}

export function useOpenClawCommands(apiKey: string | null | undefined = "SUA_API_KEY"): OpenClawCommands {
  const baseUrl = resolveBaseUrl();
  const modelRef = `modelhub/${DEFAULT_MODEL_ID}`;
  return {
    apiBaseUrl: `${baseUrl}/v1`,
    baseUrl,
    run: "npx @model-hub/openclaw-cli run",
    install: "npm install -g openclaw@latest",
    model: `npx @model-hub/openclaw-cli use ${DEFAULT_MODEL_ID}`,
    modelRef,
    models: (key?: string) =>
      `npx @model-hub/openclaw-cli models --base-url ${baseUrl} --api-key ${key ?? apiKey}`,
    setup: (key?: string) =>
      `npx @model-hub/openclaw-cli setup --base-url ${baseUrl} --api-key ${key ?? apiKey} --model ${DEFAULT_MODEL_ID}`,
    sync: (key?: string) =>
      `npx @model-hub/openclaw-cli sync --base-url ${baseUrl} --api-key ${key ?? apiKey}`,
    verify: (key?: string) =>
      `npx @model-hub/openclaw-cli doctor --base-url ${baseUrl} --api-key ${key ?? apiKey} --model ${DEFAULT_MODEL_ID}`,
  };
}
