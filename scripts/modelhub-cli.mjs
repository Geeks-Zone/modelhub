#!/usr/bin/env node

import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const CONFIG_DIR = process.env.MODELHUB_CONFIG_DIR || path.join(homedir(), ".config", "modelhub");
const OPENCLAW_CONFIG_PATH = path.join(CONFIG_DIR, "openclaw.json");

function printHelp() {
  console.log(`ModelHub CLI

Uso:
  modelhub openclaw setup [--base-url URL] [--api-key KEY] [--model MODEL] [--yes] [--headless] [--auth api-key|device]
  modelhub openclaw login [--api-key KEY] [--auth api-key|device]
  modelhub openclaw models [--base-url URL] [--api-key KEY]
  modelhub openclaw use <model>
  modelhub doctor [--base-url URL] [--api-key KEY] [--model MODEL]
  modelhub openclaw doctor [--base-url URL] [--api-key KEY] [--model MODEL]
`);
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function normalizeBaseUrl(input) {
  return input.replace(/\/+$/, "");
}

async function loadConfig() {
  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveConfig(nextConfig) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}

function resolveBaseUrl(flags, config) {
  return normalizeBaseUrl(String(flags["base-url"] || process.env.MODELHUB_BASE_URL || config.baseUrl || "http://localhost:3000"));
}

function resolveApiKey(flags, config) {
  return String(flags["api-key"] || process.env.MODELHUB_API_KEY || config.apiKey || "");
}

async function requestJson(baseUrl, route, options = {}) {
  const method = options.method || "GET";
  const headers = { "content-type": "application/json" };
  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(`${baseUrl}${route}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers,
    method,
  });

  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload, status: response.status };
}

function printSetupReceipt(receipt) {
  console.log("\nSetup receipt");
  console.log("------------");
  console.log(`provider: ${receipt.provider}`);
  console.log(`baseUrl: ${receipt.baseUrl}`);
  console.log(`modelo padrão: ${receipt.model}`);
  console.log(`catálogo: ${receipt.catalogCount} modelos`);
  console.log(`pendências: ${receipt.pending.join(", ") || "nenhuma"}`);
}

async function runSetup(args) {
  const flags = parseFlags(args);
  const config = await loadConfig();
  const baseUrl = resolveBaseUrl(flags, config);
  const apiKey = resolveApiKey(flags, config);
  const authMode = String(flags.auth || "api-key");

  if (authMode === "device") {
    console.log("Device flow ainda não está disponível no backend atual. Use --auth api-key.");
    process.exitCode = 2;
    return;
  }

  if (!apiKey) {
    console.error("API key ausente. Use --api-key ou MODELHUB_API_KEY.");
    process.exitCode = 1;
    return;
  }

  const discovery = await requestJson(baseUrl, "/openclaw/discovery", { apiKey });
  if (!discovery.ok) {
    console.error(`Falha no discovery (${discovery.status}).`, discovery.payload?.error ?? "");
    process.exitCode = 1;
    return;
  }

  const catalogResult = await requestJson(baseUrl, "/openclaw/catalog", { apiKey });
  if (!catalogResult.ok) {
    console.error(`Falha no catálogo (${catalogResult.status}).`, catalogResult.payload?.error ?? "");
    process.exitCode = 1;
    return;
  }

  const models = Array.isArray(catalogResult.payload?.models) ? catalogResult.payload.models : [];
  const recommendedCoding = Array.isArray(catalogResult.payload?.presets)
    ? catalogResult.payload.presets.find((item) => item.preset === "coding")?.model
    : null;
  const selectedModel = String(flags.model || recommendedCoding || models[0]?.unifiedModelId || "");

  if (!selectedModel) {
    console.error("Nenhum modelo disponível para configurar.");
    process.exitCode = 1;
    return;
  }

  const nextConfig = {
    apiKey,
    auth: { mode: authMode },
    baseUrl,
    model: selectedModel,
    updatedAt: new Date().toISOString(),
  };
  await saveConfig(nextConfig);

  printSetupReceipt({
    baseUrl,
    catalogCount: models.length,
    model: selectedModel,
    pending: authMode !== "api-key" ? ["auth"] : [],
    provider: "modelhub",
  });
}

async function runLogin(args) {
  const flags = parseFlags(args);
  const authMode = String(flags.auth || "api-key");

  if (authMode === "device") {
    console.log("Device flow planejado, mas ainda não disponível neste backend.");
    process.exitCode = 2;
    return;
  }

  const config = await loadConfig();
  const apiKey = resolveApiKey(flags, config);
  const baseUrl = resolveBaseUrl(flags, config);
  if (!apiKey) {
    console.error("API key ausente. Use --api-key ou MODELHUB_API_KEY.");
    process.exitCode = 1;
    return;
  }

  const status = await requestJson(baseUrl, "/openclaw/status", { apiKey });
  if (!status.ok) {
    console.error(`Falha ao validar login (${status.status}).`, status.payload?.error ?? "");
    process.exitCode = 1;
    return;
  }

  await saveConfig({
    ...config,
    apiKey,
    auth: { mode: authMode },
    baseUrl,
    updatedAt: new Date().toISOString(),
  });
  console.log("Login concluído.");
}

async function runModels(args) {
  const flags = parseFlags(args);
  const config = await loadConfig();
  const baseUrl = resolveBaseUrl(flags, config);
  const apiKey = resolveApiKey(flags, config);

  if (!apiKey) {
    console.error("API key ausente. Execute `modelhub openclaw login --api-key ...`.");
    process.exitCode = 1;
    return;
  }

  const result = await requestJson(baseUrl, "/openclaw/catalog", { apiKey });
  if (!result.ok) {
    console.error(`Falha ao listar modelos (${result.status}).`, result.payload?.error ?? "");
    process.exitCode = 1;
    return;
  }

  for (const model of result.payload.models ?? []) {
    console.log(`${model.unifiedModelId}  [${(model.presets ?? []).join(", ")}]`);
  }
}

async function runUse(args) {
  const model = args[0];
  if (!model) {
    console.error("Uso: modelhub openclaw use <model>");
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig();
  await saveConfig({
    ...config,
    model,
    updatedAt: new Date().toISOString(),
  });
  console.log(`Modelo padrão atualizado: ${model}`);
}

async function runDoctor(args) {
  const flags = parseFlags(args);
  const config = await loadConfig();
  const baseUrl = resolveBaseUrl(flags, config);
  const apiKey = resolveApiKey(flags, config);
  const model = String(flags.model || config.model || "");

  const checks = [];

  const health = await requestJson(baseUrl, "/health");
  checks.push({ name: "service_health", ok: health.ok, details: `status=${health.status}` });

  if (!apiKey) {
    checks.push({ name: "auth", ok: false, details: "API key ausente" });
  } else {
    const ocHealth = await requestJson(baseUrl, "/openclaw/health", { apiKey });
    checks.push({ name: "openclaw_health", ok: ocHealth.ok, details: `status=${ocHealth.status}` });

    const status = await requestJson(baseUrl, "/openclaw/status", { apiKey });
    checks.push({ name: "openclaw_status", ok: status.ok, details: `status=${status.status}` });

    const models = await requestJson(baseUrl, "/v1/models", { apiKey });
    checks.push({ name: "v1_models", ok: models.ok, details: `status=${models.status}` });

    if (model) {
      const prompt = await requestJson(baseUrl, "/v1/chat/completions", {
        apiKey,
        body: {
          max_tokens: 8,
          messages: [{ role: "user", content: "Responda apenas com OK" }],
          model,
          stream: false,
        },
        method: "POST",
      });
      checks.push({ name: "prompt_test", ok: prompt.ok, details: `status=${prompt.status}` });
    } else {
      checks.push({ name: "prompt_test", ok: false, details: "modelo padrão não configurado" });
    }
  }

  for (const check of checks) {
    const marker = check.ok ? "✓" : "✗";
    console.log(`${marker} ${check.name} (${check.details})`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

async function main() {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }

  if (argv[0] === "doctor") {
    await runDoctor(argv.slice(1));
    return;
  }

  if (argv[0] !== "openclaw") {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const sub = argv[1];
  const rest = argv.slice(2);

  if (sub === "setup") {
    await runSetup(rest);
    return;
  }
  if (sub === "login") {
    await runLogin(rest);
    return;
  }
  if (sub === "models") {
    await runModels(rest);
    return;
  }
  if (sub === "use") {
    await runUse(rest);
    return;
  }
  if (sub === "doctor") {
    await runDoctor(rest);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
