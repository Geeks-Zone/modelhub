import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const DEFAULT_PROVIDER_ID = 'modelhub';
const DEFAULT_SERVICE_BASE_URL = 'http://localhost:3000';

export function parseFlags(args) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      const key = withoutPrefix.slice(0, equalsIndex);
      const value = withoutPrefix.slice(equalsIndex + 1);
      flags[key] = value;
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[withoutPrefix] = true;
      continue;
    }

    flags[withoutPrefix] = next;
    index += 1;
  }

  return { flags, positionals };
}

export function normalizeBaseUrl(input) {
  return String(input ?? '').trim().replace(/\/+$/, '');
}

export function normalizeServiceBaseUrl(input) {
  const normalized = normalizeBaseUrl(input);
  return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
}

export function buildProviderBaseUrl(serviceBaseUrl) {
  return `${normalizeServiceBaseUrl(serviceBaseUrl)}/v1`;
}

export function resolveOpenClawConfigPath(env = process.env) {
  if (env.OPENCLAW_CONFIG_PATH) {
    return path.resolve(env.OPENCLAW_CONFIG_PATH);
  }

  if (env.OPENCLAW_STATE_DIR) {
    return path.join(path.resolve(env.OPENCLAW_STATE_DIR), 'openclaw.json');
  }

  return path.join(homedir(), '.openclaw', 'openclaw.json');
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Arquivo JSON invalido em ${filePath}`);
    }

    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function backupJsonFile(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.${stamp}.bak`;
  await copyFile(filePath, backupPath);
  return backupPath;
}

function ensureProviderId(providerId) {
  const normalized = String(providerId || DEFAULT_PROVIDER_ID).trim();
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(normalized)) {
    throw new Error(`Provider ID invalido: "${providerId}"`);
  }

  return normalized;
}

function getProviderConfig(config, providerId = DEFAULT_PROVIDER_ID) {
  return config?.models?.providers?.[providerId] ?? null;
}

function getPrimaryModelRef(config) {
  const primary = config?.agents?.defaults?.model?.primary;
  return typeof primary === 'string' && primary ? primary : null;
}

export function toOpenClawModelRef(providerId, backendModelId) {
  return `${providerId}/${backendModelId}`;
}

export function getSelectedBackendModelId(config, providerId = DEFAULT_PROVIDER_ID) {
  const primary = getPrimaryModelRef(config);
  if (!primary) {
    return null;
  }

  const prefix = `${providerId}/`;
  if (!primary.startsWith(prefix)) {
    return null;
  }

  return primary.slice(prefix.length);
}

function inferInputTypes(model) {
  const inputs = ['text'];
  if (model?.capabilities?.images) {
    inputs.push('image');
  }

  return inputs;
}

export function toOpenClawProviderModel(model) {
  const out = {
    id: model.unifiedModelId,
    input: inferInputTypes(model),
    name: `${model.name} (${model.providerId})`,
    reasoning: model?.capabilities?.reasoning !== 'none',
  };

  if (Number.isFinite(model.contextWindow) && model.contextWindow > 0) {
    out.contextWindow = model.contextWindow;
  }

  return out;
}

export function buildProviderConfig({ apiKey, catalog, serviceBaseUrl }) {
  return {
    api: 'openai-completions',
    apiKey,
    baseUrl: buildProviderBaseUrl(serviceBaseUrl),
    models: catalog.map(toOpenClawProviderModel),
  };
}

export function upsertModelHubIntoOpenClawConfig(
  existingConfig,
  { apiKey, catalog, providerId = DEFAULT_PROVIDER_ID, selectedModelId, serviceBaseUrl },
) {
  const next = structuredClone(existingConfig ?? {});
  const safeProviderId = ensureProviderId(providerId);
  const existingProvider = getProviderConfig(next, safeProviderId) ?? {};

  next.models ??= {};
  next.models.mode ??= 'merge';
  next.models.providers ??= {};
  next.models.providers[safeProviderId] = {
    ...existingProvider,
    ...buildProviderConfig({ apiKey, catalog, serviceBaseUrl }),
  };

  next.agents ??= {};
  next.agents.defaults ??= {};

  const currentModelConfig =
    next.agents.defaults.model && typeof next.agents.defaults.model === 'object' ? next.agents.defaults.model : {};
  next.agents.defaults.model = {
    ...currentModelConfig,
    primary: toOpenClawModelRef(safeProviderId, selectedModelId),
  };

  return next;
}

function maybeAddModelToProvider(providerConfig, modelId) {
  const models = Array.isArray(providerConfig.models) ? providerConfig.models : [];
  if (models.some((item) => item?.id === modelId)) {
    return models;
  }

  return [...models, { id: modelId, input: ['text'], name: modelId, reasoning: false }];
}

function deriveServiceBaseUrlFromConfig(config, providerId) {
  const providerConfig = getProviderConfig(config, providerId);
  if (!providerConfig?.baseUrl) {
    return '';
  }

  return normalizeServiceBaseUrl(providerConfig.baseUrl);
}

function resolveServiceBaseUrl(flags, config, providerId, env = process.env) {
  const value =
    flags['base-url'] ??
    env.MODELHUB_BASE_URL ??
    deriveServiceBaseUrlFromConfig(config, providerId) ??
    DEFAULT_SERVICE_BASE_URL;
  return normalizeServiceBaseUrl(value || DEFAULT_SERVICE_BASE_URL);
}

function resolveApiKey(flags, config, providerId, env = process.env) {
  const providerConfig = getProviderConfig(config, providerId);
  return String(flags['api-key'] ?? env.MODELHUB_API_KEY ?? providerConfig?.apiKey ?? '');
}

async function requestJson(serviceBaseUrl, route, options = {}) {
  const headers = { 'content-type': 'application/json' };
  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(`${serviceBaseUrl}${route}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers,
    method: options.method ?? 'GET',
  });

  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload, status: response.status };
}

function selectRecommendedModel(catalogPayload, preferredModel) {
  const models = Array.isArray(catalogPayload?.models) ? catalogPayload.models : [];
  if (preferredModel) {
    return preferredModel;
  }

  const presets = Array.isArray(catalogPayload?.presets) ? catalogPayload.presets : [];
  const recommendedCoding = presets.find((item) => item?.preset === 'coding')?.model;
  return String(recommendedCoding || models[0]?.unifiedModelId || '');
}

function printSetupReceipt({
  backupPath,
  catalogCount,
  configPath,
  modelRef,
  providerId,
  serviceBaseUrl,
}) {
  console.log('\nOpenClaw configurado para usar o ModelHub');
  console.log('---------------------------------------');
  console.log(`provider id: ${providerId}`);
  console.log(`service base URL: ${serviceBaseUrl}`);
  console.log(`OpenAI base URL: ${buildProviderBaseUrl(serviceBaseUrl)}`);
  console.log(`modelo primario: ${modelRef}`);
  console.log(`catalogo sincronizado: ${catalogCount} modelos`);
  console.log(`config: ${configPath}`);
  console.log(`backup: ${backupPath ?? 'nenhum (arquivo novo)'}`);
}

function printChecks(checks) {
  for (const check of checks) {
    const marker = check.ok ? 'OK ' : 'ERRO';
    console.log(`${marker} ${check.name} (${check.details})`);
  }
}

async function loadOpenClawConfig(configPath) {
  return loadJsonFile(configPath);
}

async function runSetup(args) {
  const { flags } = parseFlags(args);
  const providerId = ensureProviderId(flags['provider-id'] || DEFAULT_PROVIDER_ID);
  const authMode = String(flags.auth || 'api-key');
  const configPath = resolveOpenClawConfigPath(process.env);
  const existingConfig = await loadOpenClawConfig(configPath);
  const serviceBaseUrl = resolveServiceBaseUrl(flags, existingConfig, providerId);
  const apiKey = resolveApiKey(flags, existingConfig, providerId);

  if (authMode !== 'api-key') {
    console.error('Device flow ainda nao esta disponivel no backend atual. Use --auth api-key.');
    process.exitCode = 2;
    return;
  }

  if (!apiKey) {
    console.error('API key ausente. Use --api-key ou MODELHUB_API_KEY.');
    process.exitCode = 1;
    return;
  }

  const discovery = await requestJson(serviceBaseUrl, '/openclaw/discovery', { apiKey });
  if (!discovery.ok) {
    console.error(`Falha no discovery (${discovery.status}).`, discovery.payload?.error ?? '');
    process.exitCode = 1;
    return;
  }

  const catalogResult = await requestJson(serviceBaseUrl, '/openclaw/catalog', { apiKey });
  if (!catalogResult.ok) {
    console.error(`Falha no catalogo (${catalogResult.status}).`, catalogResult.payload?.error ?? '');
    process.exitCode = 1;
    return;
  }

  const selectedModelId = selectRecommendedModel(catalogResult.payload, flags.model);
  if (!selectedModelId) {
    console.error('Nenhum modelo disponivel para configurar.');
    process.exitCode = 1;
    return;
  }

  const nextConfig = upsertModelHubIntoOpenClawConfig(existingConfig, {
    apiKey,
    catalog: catalogResult.payload.models ?? [],
    providerId,
    selectedModelId,
    serviceBaseUrl,
  });

  const backupPath = await backupJsonFile(configPath);
  await writeJsonFile(configPath, nextConfig);
  printSetupReceipt({
    backupPath,
    catalogCount: Array.isArray(catalogResult.payload.models) ? catalogResult.payload.models.length : 0,
    configPath,
    modelRef: toOpenClawModelRef(providerId, selectedModelId),
    providerId,
    serviceBaseUrl,
  });
}

async function runLogin(args) {
  const { flags } = parseFlags(args);
  const providerId = ensureProviderId(flags['provider-id'] || DEFAULT_PROVIDER_ID);
  const authMode = String(flags.auth || 'api-key');
  const configPath = resolveOpenClawConfigPath(process.env);
  const existingConfig = await loadOpenClawConfig(configPath);
  const serviceBaseUrl = resolveServiceBaseUrl(flags, existingConfig, providerId);
  const apiKey = resolveApiKey(flags, existingConfig, providerId);

  if (authMode !== 'api-key') {
    console.error('Device flow planejado, mas ainda nao disponivel neste backend.');
    process.exitCode = 2;
    return;
  }

  if (!apiKey) {
    console.error('API key ausente. Use --api-key ou MODELHUB_API_KEY.');
    process.exitCode = 1;
    return;
  }

  const status = await requestJson(serviceBaseUrl, '/openclaw/status', { apiKey });
  if (!status.ok) {
    console.error(`Falha ao validar login (${status.status}).`, status.payload?.error ?? '');
    process.exitCode = 1;
    return;
  }

  const catalogResult = await requestJson(serviceBaseUrl, '/openclaw/catalog', { apiKey });
  const currentModelId = getSelectedBackendModelId(existingConfig, providerId);
  const selectedModelId = selectRecommendedModel(catalogResult.payload, flags.model || currentModelId);
  if (!selectedModelId) {
    console.error('Nenhum modelo disponivel para persistir no OpenClaw.');
    process.exitCode = 1;
    return;
  }

  const nextConfig = upsertModelHubIntoOpenClawConfig(existingConfig, {
    apiKey,
    catalog: Array.isArray(catalogResult.payload?.models) ? catalogResult.payload.models : [],
    providerId,
    selectedModelId,
    serviceBaseUrl,
  });

  const backupPath = await backupJsonFile(configPath);
  await writeJsonFile(configPath, nextConfig);
  console.log(`Login concluido. Config atualizado em ${configPath}.`);
  if (backupPath) {
    console.log(`Backup salvo em ${backupPath}.`);
  }
}

async function runModels(args) {
  const { flags } = parseFlags(args);
  const providerId = ensureProviderId(flags['provider-id'] || DEFAULT_PROVIDER_ID);
  const configPath = resolveOpenClawConfigPath(process.env);
  const existingConfig = await loadOpenClawConfig(configPath);
  const serviceBaseUrl = resolveServiceBaseUrl(flags, existingConfig, providerId);
  const apiKey = resolveApiKey(flags, existingConfig, providerId);

  if (!apiKey) {
    console.error('API key ausente. Execute `setup` ou `login` primeiro.');
    process.exitCode = 1;
    return;
  }

  const result = await requestJson(serviceBaseUrl, '/openclaw/catalog', { apiKey });
  if (!result.ok) {
    console.error(`Falha ao listar modelos (${result.status}).`, result.payload?.error ?? '');
    process.exitCode = 1;
    return;
  }

  for (const model of result.payload.models ?? []) {
    const modelRef = toOpenClawModelRef(providerId, model.unifiedModelId);
    console.log(`${modelRef}  [${(model.presets ?? []).join(', ')}]`);
  }
}

async function runUse(args) {
  const { flags, positionals } = parseFlags(args);
  const providerId = ensureProviderId(flags['provider-id'] || DEFAULT_PROVIDER_ID);
  const modelId = positionals[0];
  if (!modelId) {
    console.error('Uso: modelhub-openclaw use <model-id>');
    process.exitCode = 1;
    return;
  }

  const configPath = resolveOpenClawConfigPath(process.env);
  const existingConfig = await loadOpenClawConfig(configPath);
  const providerConfig = getProviderConfig(existingConfig, providerId);
  if (!providerConfig) {
    console.error('Provider do ModelHub nao encontrado no openclaw.json. Execute `setup` primeiro.');
    process.exitCode = 1;
    return;
  }

  const nextConfig = structuredClone(existingConfig);
  nextConfig.models.providers[providerId] = {
    ...providerConfig,
    models: maybeAddModelToProvider(providerConfig, modelId),
  };

  nextConfig.agents ??= {};
  nextConfig.agents.defaults ??= {};
  nextConfig.agents.defaults.model = {
    ...(nextConfig.agents.defaults.model && typeof nextConfig.agents.defaults.model === 'object'
      ? nextConfig.agents.defaults.model
      : {}),
    primary: toOpenClawModelRef(providerId, modelId),
  };

  const backupPath = await backupJsonFile(configPath);
  await writeJsonFile(configPath, nextConfig);
  console.log(`Modelo primario atualizado para ${toOpenClawModelRef(providerId, modelId)}.`);
  if (backupPath) {
    console.log(`Backup salvo em ${backupPath}.`);
  }
}

async function runDoctor(args) {
  const { flags } = parseFlags(args);
  const providerId = ensureProviderId(flags['provider-id'] || DEFAULT_PROVIDER_ID);
  const configPath = resolveOpenClawConfigPath(process.env);
  const configExists = await fileExists(configPath);
  const config = configExists ? await loadOpenClawConfig(configPath) : {};
  const providerConfig = getProviderConfig(config, providerId);
  const serviceBaseUrl = resolveServiceBaseUrl(flags, config, providerId);
  const apiKey = resolveApiKey(flags, config, providerId);
  const backendModelId = String(flags.model || getSelectedBackendModelId(config, providerId) || '');
  const modelRef = backendModelId ? toOpenClawModelRef(providerId, backendModelId) : null;

  const checks = [
    {
      details: configPath,
      name: 'openclaw_config',
      ok: configExists,
    },
    {
      details: providerConfig ? buildProviderBaseUrl(serviceBaseUrl) : 'provider ausente',
      name: 'modelhub_provider',
      ok: Boolean(providerConfig),
    },
    {
      details: modelRef ?? 'modelo primario ausente',
      name: 'selected_model',
      ok: Boolean(modelRef),
    },
  ];

  const health = await requestJson(serviceBaseUrl, '/health');
  checks.push({ details: `status=${health.status}`, name: 'service_health', ok: health.ok });

  if (!apiKey) {
    checks.push({ details: 'API key ausente', name: 'auth', ok: false });
    printChecks(checks);
    process.exitCode = 1;
    return;
  }

  const discovery = await requestJson(serviceBaseUrl, '/openclaw/discovery', { apiKey });
  checks.push({ details: `status=${discovery.status}`, name: 'discovery', ok: discovery.ok });

  const ocHealth = await requestJson(serviceBaseUrl, '/openclaw/health', { apiKey });
  checks.push({ details: `status=${ocHealth.status}`, name: 'openclaw_health', ok: ocHealth.ok });

  const status = await requestJson(serviceBaseUrl, '/openclaw/status', { apiKey });
  checks.push({ details: `status=${status.status}`, name: 'openclaw_status', ok: status.ok });

  const models = await requestJson(serviceBaseUrl, '/v1/models', { apiKey });
  checks.push({ details: `status=${models.status}`, name: 'v1_models', ok: models.ok });

  if (backendModelId) {
    const prompt = await requestJson(serviceBaseUrl, '/v1/chat/completions', {
      apiKey,
      body: {
        max_tokens: 8,
        messages: [{ content: 'Responda apenas com OK', role: 'user' }],
        model: backendModelId,
        stream: false,
      },
      method: 'POST',
    });
    checks.push({ details: `status=${prompt.status}`, name: 'prompt_test', ok: prompt.ok });
  } else {
    checks.push({ details: 'modelo padrao nao configurado', name: 'prompt_test', ok: false });
  }

  printChecks(checks);
  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

function printStandaloneHelp() {
  console.log(`ModelHub OpenClaw CLI

Uso:
  npx @model-hub/openclaw-cli setup [--base-url URL] [--api-key KEY] [--model MODEL] [--provider-id ID]
  npx @model-hub/openclaw-cli login [--base-url URL] [--api-key KEY] [--provider-id ID]
  npx @model-hub/openclaw-cli models [--base-url URL] [--api-key KEY] [--provider-id ID]
  npx @model-hub/openclaw-cli use <model-id> [--provider-id ID]
  npx @model-hub/openclaw-cli doctor [--base-url URL] [--api-key KEY] [--model MODEL] [--provider-id ID]

Observacoes:
  - O OpenClaw sera configurado no arquivo ~/.openclaw/openclaw.json
  - O provider customizado usa base URL <SEU_MODELHUB>/v1
  - O model ref final no OpenClaw fica no formato modelhub/<provider/model-id>`);
}

function printLegacyHelp() {
  console.log(`ModelHub CLI

Uso:
  modelhub openclaw setup [--base-url URL] [--api-key KEY] [--model MODEL] [--provider-id ID]
  modelhub openclaw login [--base-url URL] [--api-key KEY] [--provider-id ID]
  modelhub openclaw models [--base-url URL] [--api-key KEY] [--provider-id ID]
  modelhub openclaw use <model-id> [--provider-id ID]
  modelhub doctor [--base-url URL] [--api-key KEY] [--model MODEL] [--provider-id ID]
  modelhub openclaw doctor [--base-url URL] [--api-key KEY] [--model MODEL] [--provider-id ID]

Dica:
  Para o fluxo via npx, use:
  npx @model-hub/openclaw-cli setup --base-url https://www.modelhub.com.br --api-key SUA_API_KEY`);
}

async function dispatchCommand(command, args) {
  if (command === 'setup') {
    await runSetup(args);
    return;
  }

  if (command === 'login') {
    await runLogin(args);
    return;
  }

  if (command === 'models') {
    await runModels(args);
    return;
  }

  if (command === 'use') {
    await runUse(args);
    return;
  }

  if (command === 'doctor') {
    await runDoctor(args);
    return;
  }

  printStandaloneHelp();
  process.exitCode = 1;
}

export async function runStandaloneCli(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printStandaloneHelp();
    return;
  }

  await dispatchCommand(argv[0], argv.slice(1));
}

export async function runLegacyModelHubCli(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printLegacyHelp();
    return;
  }

  if (argv[0] === 'doctor') {
    await runDoctor(argv.slice(1));
    return;
  }

  if (argv[0] !== 'openclaw') {
    printLegacyHelp();
    process.exitCode = 1;
    return;
  }

  const subCommand = argv[1];
  if (!subCommand) {
    printLegacyHelp();
    process.exitCode = 1;
    return;
  }

  await dispatchCommand(subCommand, argv.slice(2));
}

