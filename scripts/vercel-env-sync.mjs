#!/usr/bin/env node
/**
 * Compara chaves entre Vercel (`vercel env ls`) e um arquivo .env local (sem ler valores).
 * Uso:
 *   node scripts/vercel-env-sync.mjs
 *   node scripts/vercel-env-sync.mjs --pull
 *   node scripts/vercel-env-sync.mjs --pull --environment preview
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/** Injetada pelo `vercel env pull`; não existe como entrada manual na UI da Vercel. */
const LOCAL_CLI_INJECTED = new Set(["VERCEL_OIDC_TOKEN"]);

function parseArgs(argv) {
  const pull = argv.includes("--pull");
  let environment = "development";
  const envIdx = argv.indexOf("--environment");
  if (envIdx !== -1 && argv[envIdx + 1]) {
    environment = argv[envIdx + 1];
  }
  if (!["development", "preview", "production"].includes(environment)) {
    console.error('Use --environment development | preview | production');
    process.exit(1);
  }
  return { pull, environment };
}

function parseEnvFileKeys(filePath) {
  if (!existsSync(filePath)) {
    return new Set();
  }
  const text = readFileSync(filePath, "utf8");
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) {
      keys.add(m[1]);
    }
  }
  return keys;
}

function getRemoteKeys(environment) {
  const out = execSync(`vercel env ls ${environment} --format json`, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const data = JSON.parse(out.trim());
  return new Set((data.envs ?? []).map((e) => e.key));
}

function localPathForEnvironment(environment) {
  if (environment === "development") {
    return join(root, ".env.local");
  }
  return join(root, `.env.vercel.${environment}.local`);
}

const { pull, environment } = parseArgs(process.argv.slice(2));
const localFile = localPathForEnvironment(environment);

if (pull) {
  const rel =
    environment === "development" ? ".env.local" : `.env.vercel.${environment}.local`;
  execSync(`vercel env pull ${rel} -y --environment ${environment}`, {
    cwd: root,
    stdio: "inherit",
  });
}

const local = parseEnvFileKeys(localFile);
let remote;
try {
  remote = getRemoteKeys(environment);
} catch (e) {
  console.error("Falha ao listar variáveis na Vercel. Rode `vercel link` e `vercel login`.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

const localComparable = new Set([...local].filter((k) => !LOCAL_CLI_INJECTED.has(k)));

const onlyRemote = [...remote].filter((k) => !local.has(k)).sort();
const onlyLocal = [...localComparable].filter((k) => !remote.has(k)).sort();

const localFileLabel = environment === "development" ? ".env.local" : `.env.vercel.${environment}.local`;

console.log("");
console.log(`Ambiente Vercel: ${environment}`);
console.log(`Arquivo local:   ${localFileLabel}`);
console.log("");

if (onlyRemote.length === 0 && onlyLocal.length === 0) {
  console.log("Chaves alinhadas com a Vercel (ignorando VERCEL_OIDC_TOKEN do CLI).");
} else {
  if (onlyRemote.length > 0) {
    console.log("Só na Vercel (ausentes no arquivo local):");
    for (const k of onlyRemote) {
      console.log(`  - ${k}`);
    }
    console.log("");
  }
  if (onlyLocal.length > 0) {
    console.log("Só no arquivo local (não aparecem neste ambiente na Vercel):");
    for (const k of onlyLocal) {
      console.log(`  - ${k}`);
    }
    console.log("");
  }
}

console.log(
  "Valores não são comparados (segredo). Para sobrescrever o local com a nuvem, use: pnpm vercel:env:pull",
);
console.log(
  "Para enviar alterações locais à Vercel, use `vercel env add NOME` por variável ou o dashboard.",
);
console.log("");
