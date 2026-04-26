import { access, chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  buildProviderBaseUrl,
  buildProviderConfig,
  sanitizeProviderModels,
  toOpenClawModelRef,
} from './utils.mjs';

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function writeJsonFile(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  // 0o600: o arquivo guarda apiKey/token em texto claro; restringimos leitura
  // ao dono para reduzir o blast radius em sistemas multiusuario.
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function backupJsonFile(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.${stamp}.bak`;
  await copyFile(filePath, backupPath);
  await chmod(backupPath, 0o600);
  return backupPath;
}

function generateToken() {
  return randomBytes(24).toString('hex');
}

function ensureGatewayHttpEndpoints(config) {
  config.gateway ??= {};
  config.gateway.http ??= {};
  config.gateway.http.endpoints ??= {};
  config.gateway.http.endpoints.chatCompletions = {
    ...(typeof config.gateway.http.endpoints.chatCompletions === 'object' && config.gateway.http.endpoints.chatCompletions
      ? config.gateway.http.endpoints.chatCompletions
      : {}),
    enabled: true,
  };
}

export function ensureGatewayToken(config) {
  const existing = config?.gateway?.auth?.token;
  if (existing && typeof existing === 'string') {
    const next = structuredClone(config ?? {});
    ensureGatewayHttpEndpoints(next);
    return { config: next, token: existing };
  }

  const token = generateToken();
  const next = structuredClone(config ?? {});
  next.gateway ??= {};
  next.gateway.mode ??= 'local';
  ensureGatewayHttpEndpoints(next);
  next.gateway.auth = {
    ...(typeof next.gateway.auth === 'object' && next.gateway.auth ? next.gateway.auth : {}),
    mode: 'token',
    token,
  };
  return { config: next, token };
}

function cloneModelDefaults(config) {
  const defaults = config?.agents?.defaults ?? {};
  const currentModel = defaults.model && typeof defaults.model === 'object' ? defaults.model : {};
  return {
    currentModel,
    defaults,
  };
}

function mergeModelAliases(existingAliases, catalog, providerId) {
  const nextAliases = { ...(existingAliases ?? {}) };
  for (const model of catalog) {
    const alias = model.alias || model.name;
    if (!alias) {
      continue;
    }
    nextAliases[toOpenClawModelRef(providerId, model.unifiedModelId)] = { alias };
  }
  return nextAliases;
}

/**
 * Algoritmo unico de selecao de modelo primario, compartilhado por
 * `mergeConfig`, `runSync`, `buildSyncedOpenClawConfig`. Antes existiam tres
 * implementacoes que disputavam (primary do servidor x do config local x do
 * preset coding) e produziam resultados diferentes para o mesmo input.
 *
 * Ordem de prioridade:
 *   1. preferredModelId explicito (vindo de --model ou flag).
 *   2. primary atual do config local, se ainda existir no catalogo.
 *   3. selectedModelId do preset (ex: recomendacao de "coding").
 *   4. primeiro modelo do catalogo.
 *
 * Retorna a referencia ja prefixada com providerId.
 */
export function selectPrimaryModelRef({
  catalog,
  currentPrimary,
  preferredModelId,
  providerId,
  selectedModelId,
}) {
  const validRefs = new Set(catalog.map((model) => toOpenClawModelRef(providerId, model.unifiedModelId)));
  const prefix = `${providerId}/`;
  const stripPrefix = (ref) => (typeof ref === 'string' && ref.startsWith(prefix) ? ref.slice(prefix.length) : ref);

  const ensureRef = (modelIdOrRef) => {
    if (!modelIdOrRef) return '';
    const id = stripPrefix(String(modelIdOrRef));
    return id ? toOpenClawModelRef(providerId, id) : '';
  };

  const candidates = [
    ensureRef(preferredModelId),
    currentPrimary && validRefs.has(currentPrimary) ? currentPrimary : '',
    ensureRef(selectedModelId),
    catalog[0]?.unifiedModelId ? toOpenClawModelRef(providerId, catalog[0].unifiedModelId) : '',
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return currentPrimary ?? null;
}

function selectPrimaryModel(nextConfig, providerId, catalog, selectedModelId) {
  return selectPrimaryModelRef({
    catalog,
    currentPrimary: nextConfig?.agents?.defaults?.model?.primary,
    preferredModelId: '',
    providerId,
    selectedModelId,
  });
}

export function upsertRuntimeConfig(localConfig, { apiKeyValue, providerId, serviceBaseUrl }) {
  const next = structuredClone(localConfig ?? {});

  next.models ??= {};
  next.models.mode ??= 'merge';
  next.models.providers ??= {};

  const existingProvider = next.models.providers[providerId] ?? {};
  next.models.providers[providerId] = {
    ...existingProvider,
    api: existingProvider.api || 'openai-completions',
    apiKey: apiKeyValue,
    baseUrl: buildProviderBaseUrl(serviceBaseUrl),
    models: sanitizeProviderModels(existingProvider.models),
  };

  next.gateway ??= {};
  next.gateway.mode ??= 'local';
  ensureGatewayHttpEndpoints(next);

  return next;
}

export function mergeConfig(localConfig, {
  apiKeyValue,
  catalog,
  providerId,
  selectedModelId,
  serviceBaseUrl,
}) {
  const next = upsertRuntimeConfig(localConfig, { apiKeyValue, providerId, serviceBaseUrl });
  const providerConfig = next.models.providers[providerId] ?? {};
  const mergedProvider = buildProviderConfig({
    apiKey: apiKeyValue,
    catalog,
    serviceBaseUrl,
    useEnvVar: false,
  });

  next.models.providers[providerId] = {
    ...providerConfig,
    ...mergedProvider,
    apiKey: apiKeyValue,
  };

  const { currentModel, defaults } = cloneModelDefaults(next);
  const currentAliases =
    next?.agents?.defaults?.models && typeof next.agents.defaults.models === 'object'
      ? next.agents.defaults.models
      : {};

  next.agents = {
    ...(next.agents ?? {}),
    defaults: {
      ...defaults,
      model: {
        ...currentModel,
        primary: selectPrimaryModel(next, providerId, catalog, selectedModelId),
      },
      models: mergeModelAliases(currentAliases, catalog, providerId),
    },
  };

  return next;
}
