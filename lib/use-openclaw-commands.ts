import { DEFAULT_MODEL_ID } from "@/lib/defaults";

const MODELHUB_BASE_URL = "https://www.modelhub.com.br";

type OpenClawCommands = {
  run: string;
  install: string;
  model: string;
  setup: (key?: string) => string;
  sync: (key?: string) => string;
  verify: (key?: string) => string;
};

export function useOpenClawCommands(apiKey?: string | null): OpenClawCommands {
  const resolvedKey = apiKey ?? "SUA_API_KEY";

  return {
    run: "npx @model-hub/openclaw-cli run",
    install: "npm install -g openclaw@latest",
    model: `npx @model-hub/openclaw-cli use ${DEFAULT_MODEL_ID}`,
    setup: (key?: string) =>
      `npx @model-hub/openclaw-cli setup --base-url ${MODELHUB_BASE_URL} --api-key ${key ?? resolvedKey} --model ${DEFAULT_MODEL_ID}`,
    sync: (key?: string) =>
      `npx @model-hub/openclaw-cli sync --base-url ${MODELHUB_BASE_URL} --api-key ${key ?? resolvedKey}`,
    verify: (key?: string) =>
      `npx @model-hub/openclaw-cli doctor --base-url ${MODELHUB_BASE_URL} --api-key ${key ?? resolvedKey} --model ${DEFAULT_MODEL_ID}`,
  };
}
