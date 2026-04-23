import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

import {
  parseFlags,
  normalizeBaseUrl,
  normalizeServiceBaseUrl,
  buildProviderBaseUrl,
  resolveOpenClawConfigPath,
  toOpenClawModelRef,
  toOpenClawProviderModel,
  buildProviderConfig,
} from './utils.mjs';
import {
  derivePersistedApiKeyValue,
  resolveCredentials,
} from './credentials.mjs';

export {
  parseFlags,
  normalizeBaseUrl,
  normalizeServiceBaseUrl,
  buildProviderBaseUrl,
  resolveOpenClawConfigPath,
  toOpenClawModelRef,
  toOpenClawProviderModel,
  buildProviderConfig,
};

const DEFAULT_PROVIDER_ID = 'modelhub';
const DEFAULT_SERVICE_BASE_URL = 'https://www.modelhub.com.br';

function normalizeBackendModelId(modelRef, providerId = DEFAULT_PROVIDER_ID) {
  const value = typeof modelRef === 'string' ? modelRef.trim() : '';
  if (!value) {
    return '';
  }

  const prefix = `${providerId}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function toConfiguredModelRef(providerId, modelRef) {
  const backendModelId = normalizeBackendModelId(modelRef, providerId);
  return backendModelId ? toOpenClawModelRef(providerId, backendModelId) : '';
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

export function resolveModelHubApiKey(flags, config, providerId = DEFAULT_PROVIDER_ID) {
  const resolved = resolveCredentials(flags, config, providerId);
  if (!resolved.apiKey && resolved.apiKeySource === 'config-env-ref') {
    throw new Error('MODELHUB_API_KEY nao encontrado no ambiente. Exporte MODELHUB_API_KEY ou use --api-key.');
  }

  return {
    ...resolved,
    persistedApiKeyValue: derivePersistedApiKeyValue({
      apiKey: resolved.apiKey,
      apiKeyConfigValue: resolved.apiKeyConfigValue,
      source: resolved.apiKeySource,
    }),
  };
}

export function upsertModelHubIntoOpenClawConfig(
  existingConfig,
  { apiKey, catalog, providerId = DEFAULT_PROVIDER_ID, selectedModelId, serviceBaseUrl, useEnvVar = false },
) {
  const next = structuredClone(existingConfig ?? {});
  const safeProviderId = ensureProviderId(providerId);
  const existingProvider = getProviderConfig(next, safeProviderId) ?? {};

  next.models ??= {};
  next.models.mode ??= 'merge';
  next.models.providers ??= {};
  next.models.providers[safeProviderId] = {
    ...existingProvider,
    ...buildProviderConfig({ apiKey, catalog, serviceBaseUrl, useEnvVar }),
  };

  next.agents ??= {};
  next.agents.defaults ??= {};

  const currentModelConfig =
    next.agents.defaults.model && typeof next.agents.defaults.model === 'object' ? next.agents.defaults.model : {};
  const currentAliases =
    next.agents.defaults.models && typeof next.agents.defaults.models === 'object' ? next.agents.defaults.models : {};

  const mergedAliases = { ...currentAliases };
  for (const model of catalog) {
    if (model.alias && model.alias !== model.name) {
      mergedAliases[toConfiguredModelRef(safeProviderId, model.unifiedModelId)] = { alias: model.alias };
    }
  }

  next.agents.defaults.model = {
    ...currentModelConfig,
    primary: toOpenClawModelRef(safeProviderId, selectedModelId),
  };

  if (Object.keys(mergedAliases).length > 0) {
    next.agents.defaults.models = mergedAliases;
  }

  next.gateway ??= {};
  if (!next.gateway.mode) {
    next.gateway.mode = 'local';
  }

  if (!next.gateway.auth) {
    next.gateway.auth = next.gateway.auth || 'none';
  }

  return next;
}

function normalizeRemoteProviderModels(remoteModels, providerId = DEFAULT_PROVIDER_ID) {
  if (!Array.isArray(remoteModels)) {
    return [];
  }

  const normalized = [];
  for (const model of remoteModels) {
    const backendModelId = normalizeBackendModelId(model?.id, providerId);
    if (!backendModelId) {
      continue;
    }

    normalized.push({
      ...model,
      id: backendModelId,
      name: typeof model?.name === 'string' && model.name.trim() ? model.name : backendModelId,
    });
  }

  return normalized;
}

function buildRemoteAliasRecord(remoteModels, remoteAliases, providerId = DEFAULT_PROVIDER_ID) {
  const nextAliases = {};

  for (const model of remoteModels) {
    if (typeof model?.alias === 'string' && model.alias.trim() && model.alias !== model.name) {
      nextAliases[toConfiguredModelRef(providerId, model.id)] = { alias: model.alias };
    }
  }

  if (!remoteAliases || typeof remoteAliases !== 'object') {
    return nextAliases;
  }

  for (const [modelRef, value] of Object.entries(remoteAliases)) {
    const backendModelId = normalizeBackendModelId(modelRef, providerId);
    if (!backendModelId) {
      continue;
    }

    const alias =
      typeof value === 'string'
        ? value
        : typeof value?.alias === 'string'
          ? value.alias
          : '';
    if (!alias.trim()) {
      continue;
    }

    nextAliases[toConfiguredModelRef(providerId, backendModelId)] = { alias };
  }

  return nextAliases;
}

export function buildSyncedOpenClawConfig(
  existingConfig,
  remoteConfig,
  { apiKeyValue, preferredModelId = '', providerId = DEFAULT_PROVIDER_ID, serviceBaseUrl },
) {
  const remoteProvider = remoteConfig?.models?.providers?.[providerId];
  if (!remoteProvider || typeof remoteProvider !== 'object') {
    throw new Error(`Config remoto invalido: provider "${providerId}" ausente.`);
  }

  const normalizedModels = normalizeRemoteProviderModels(remoteProvider.models, providerId);
  if (normalizedModels.length === 0) {
    throw new Error(`Config remoto invalido: provider "${providerId}" sem modelos.`);
  }

  const next = structuredClone(existingConfig ?? {});
  next.models ??= {};
  next.models.mode =
    typeof remoteConfig?.models?.mode === 'string' && remoteConfig.models.mode
      ? remoteConfig.models.mode
      : next.models.mode ?? 'merge';
  next.models.providers ??= {};

  const existingProvider = getProviderConfig(next, providerId) ?? {};
  next.models.providers[providerId] = {
    ...existingProvider,
    ...remoteProvider,
    apiKey: apiKeyValue,
    baseUrl:
      typeof remoteProvider.baseUrl === 'string' && remoteProvider.baseUrl.trim()
        ? remoteProvider.baseUrl
        : buildProviderBaseUrl(serviceBaseUrl),
    models: normalizedModels,
  };

  next.agents ??= {};
  next.agents.defaults ??= {};

  const currentModelConfig =
    next.agents.defaults.model && typeof next.agents.defaults.model === 'object' ? next.agents.defaults.model : {};
  const currentAliases =
    next.agents.defaults.models && typeof next.agents.defaults.models === 'object' ? next.agents.defaults.models : {};
  const remoteModelConfig =
    remoteConfig?.agents?.defaults?.model && typeof remoteConfig.agents.defaults.model === 'object'
      ? remoteConfig.agents.defaults.model
      : {};

  const preferredBackendModelId = normalizeBackendModelId(preferredModelId, providerId);
  const remotePrimaryBackendModelId = normalizeBackendModelId(remoteModelConfig.primary, providerId);
  const primaryBackendModelId =
    preferredBackendModelId || remotePrimaryBackendModelId || normalizedModels[0]?.id || '';

  const fallbackModelRefs = Array.isArray(remoteModelConfig.fallbacks)
    ? [...new Set(
        remoteModelConfig.fallbacks
          .map((modelRef) => normalizeBackendModelId(modelRef, providerId))
          .filter((modelRef) => modelRef && modelRef !== primaryBackendModelId),
      )].map((modelRef) => toConfiguredModelRef(providerId, modelRef))
    : [];

  const preservedAliases = Object.fromEntries(
    Object.entries(currentAliases).filter(([modelRef]) => !modelRef.startsWith(`${providerId}/`)),
  );
  const remoteAliases = buildRemoteAliasRecord(
    normalizedModels,
    remoteConfig?.agents?.defaults?.models,
    providerId,
  );

  next.agents.defaults.model = {
    ...currentModelConfig,
    fallbacks: fallbackModelRefs,
    primary: toConfiguredModelRef(providerId, primaryBackendModelId),
  };
  next.agents.defaults.models = {
    ...preservedAliases,
    ...remoteAliases,
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

async function ensureOpenClawInstalled() {
  try {
    execSync('openclaw --version', { stdio: 'pipe' });
    return true;
  } catch {}

  console.log('OpenClaw nao encontrado. Instalando...');
  try {
    execSync('npm install -g openclaw@latest', { stdio: 'inherit' });
    console.log('OpenClaw instalado com sucesso.\n');
    return true;
  } catch {
    console.error('Falha ao instalar o OpenClaw automaticamente.');
    console.error('Instale manualmente com: npm install -g openclaw@latest');
    console.error('Depois rode o setup novamente.');
    return false;
  }
}

function isOpenClawInstalled() {
  try {
    execSync('openclaw --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function runSetup(args) {
  const { flags } = parseFlags(args);
  const providerId = ensureProviderId(flags['provider-id'] || DEFAULT_PROVIDER_ID);
  const authMode = String(flags.auth || 'api-key');
  const configPath = resolveOpenClawConfigPath(process.env);
  const existingConfig = await loadOpenClawConfig(configPath);
  const serviceBaseUrl = resolveServiceBaseUrl(flags, existingConfig, providerId);
  let apiKeyContext;
  try {
    apiKeyContext = resolveModelHubApiKey(flags, existingConfig, providerId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const apiKey = apiKeyContext.apiKey;

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

  if (!isOpenClawInstalled()) {
    console.log('OpenClaw nao esta instalado. Instalando automaticamente...\n');
    const installed = await ensureOpenClawInstalled();
    if (!installed) {
      process.exitCode = 1;
      return;
    }
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
    apiKey: apiKeyContext.persistedApiKeyValue,
    catalog: catalogResult.payload.models ?? [],
    providerId,
    selectedModelId,
    serviceBaseUrl,
    useEnvVar: false,
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
  let apiKeyContext;
  try {
    apiKeyContext = resolveModelHubApiKey(flags, existingConfig, providerId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const apiKey = apiKeyContext.apiKey;

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
    apiKey: apiKeyContext.persistedApiKeyValue,
    catalog: Array.isArray(catalogResult.payload?.models) ? catalogResult.payload.models : [],
    providerId,
    selectedModelId,
    serviceBaseUrl,
    useEnvVar: false,
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
  let apiKeyContext;
  try {
    apiKeyContext = resolveModelHubApiKey(flags, existingConfig, providerId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const apiKey = apiKeyContext.apiKey;

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

async function runSync(args) {
  const { flags } = parseFlags(args);
  const providerId = ensureProviderId(flags['provider-id'] || DEFAULT_PROVIDER_ID);
  const configPath = resolveOpenClawConfigPath(process.env);
  const existingConfig = await loadOpenClawConfig(configPath);
  const serviceBaseUrl = resolveServiceBaseUrl(flags, existingConfig, providerId);
  let apiKeyContext;
  try {
    apiKeyContext = resolveModelHubApiKey(flags, existingConfig, providerId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const apiKey = apiKeyContext.apiKey;

  if (!apiKey) {
    console.error('API key ausente. Use --api-key ou MODELHUB_API_KEY.');
    process.exitCode = 1;
    return;
  }

  const configResult = await requestJson(serviceBaseUrl, '/openclaw/config', { apiKey });
  if (!configResult.ok) {
    console.error(`Falha ao obter config (${configResult.status}).`, configResult.payload?.error ?? '');
    process.exitCode = 1;
    return;
  }

  const remoteConfig = configResult.payload;
  const currentModelId = getSelectedBackendModelId(existingConfig, providerId);
  let nextConfig;
  try {
    nextConfig = buildSyncedOpenClawConfig(existingConfig, remoteConfig, {
      apiKeyValue: apiKeyContext.persistedApiKeyValue,
      preferredModelId: flags.model || currentModelId || '',
      providerId,
      serviceBaseUrl,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const backupPath = await backupJsonFile(configPath);
  await writeJsonFile(configPath, nextConfig);

  const modelCount = Array.isArray(nextConfig.models?.providers?.[providerId]?.models)
    ? nextConfig.models.providers[providerId].models.length
    : 0;
  console.log(`Config sincronizado com ${modelCount} modelos, fallbacks e aliases.`);
  console.log(`Modelo primario: ${nextConfig.agents.defaults.model?.primary ?? 'nenhum'}`);
  if (nextConfig.agents.defaults.model?.fallbacks?.length) {
    console.log(`Fallbacks: ${nextConfig.agents.defaults.model.fallbacks.join(', ')}`);
  }
  console.log(`Config: ${configPath}`);
  console.log(`Backup: ${backupPath ?? 'nenhum (arquivo novo)'}`);
  console.log(`\nDica: export MODELHUB_API_KEY=${apiKeyContext.persistedApiKeyValue === '${MODELHUB_API_KEY}' ? 'sua_key_aqui' : '***'} para que o OpenClaw resolva a env var.`);
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
  let apiKeyContext;
  try {
    apiKeyContext = resolveModelHubApiKey(flags, config, providerId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const apiKey = apiKeyContext.apiKey;
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

async function runInstall() {
  if (isOpenClawInstalled()) {
    const version = execSync('openclaw --version', { encoding: 'utf-8' }).trim();
    console.log(`OpenClaw ja esta instalado (versao ${version}).`);
    return;
  }

  const installed = await ensureOpenClawInstalled();
  if (!installed) {
    process.exitCode = 1;
  }
}

function printStandaloneHelp() {
  console.log(`ModelHub OpenClaw CLI

Uso:
  npx @model-hub/openclaw-cli run [--api-key KEY] [--base-url URL] [--verbose] [--debug]
  npx @model-hub/openclaw-cli setup [--base-url URL] [--api-key KEY] [--model MODEL] [--provider-id ID]
  npx @model-hub/openclaw-cli sync [--base-url URL] [--api-key KEY] [--provider-id ID]
  npx @model-hub/openclaw-cli login [--base-url URL] [--api-key KEY] [--provider-id ID]
  npx @model-hub/openclaw-cli models [--base-url URL] [--api-key KEY] [--provider-id ID]
  npx @model-hub/openclaw-cli use <model-id> [--provider-id ID]
  npx @model-hub/openclaw-cli doctor [--base-url URL] [--api-key KEY] [--model MODEL] [--provider-id ID]
  npx @model-hub/openclaw-cli install

Comandos:
  run       Inicia o bridge local (comando principal, recomendado)
  setup     Configura o OpenClaw para usar o ModelHub (avancado)
  sync      Sincroniza config com fallbacks e aliases do servidor
  bridge    Alias para "run" (compatibilidade)
  login     Re-valida auth e atualiza catalogo
  models    Lista modelos disponiveis
  use       Troca o modelo primario
  doctor    Verifica saude da integracao
  install   Instala o OpenClaw (se nao estiver instalado)

Opcoes do "run":
  --api-key KEY         API Key do ModelHub (ou usar env/config)
  --base-url URL        URL do ModelHub (default: https://www.modelhub.com.br)
  --bridge-port PORT    Porta do bridge (default: 18790)
  --gateway-port PORT   Porta do gateway (default: 18789)
  --openclaw-bin PATH   Caminho do binario openclaw
  --verbose             Mostra progresso detalhado
  --debug               Mostra tudo (frames WS, etc.)

Observacoes:
  - O comando "run" e o fluxo oficial. Ele diagnostica, instala, configura
    e inicia tudo automaticamente.
  - Se nao houver credenciais, o CLI pede a API Key no terminal (uma vez).
  - O browser detecta o bridge automaticamente em http://127.0.0.1:18790
  - O OpenClaw e configurado em ~/.openclaw/openclaw.json`);
}

function printLegacyHelp() {
  console.log(`ModelHub CLI

Uso:
  modelhub openclaw setup [--base-url URL] [--api-key KEY] [--model MODEL] [--provider-id ID]
  modelhub openclaw sync [--base-url URL] [--api-key KEY] [--provider-id ID]
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
  if (command === 'run' || command === 'bridge') {
    const { run } = await import('./run.mjs');
    await run(args);
    return;
  }

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

  if (command === 'sync') {
    await runSync(args);
    return;
  }

  if (command === 'doctor') {
    await runDoctor(args);
    return;
  }

  if (command === 'install') {
    await runInstall();
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
