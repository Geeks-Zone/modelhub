import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  buildProviderBaseUrl,
  buildProviderConfig,
  toOpenClawModelRef,
} from './utils.mjs';

export async function fileExists(filePath) {
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
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function backupJsonFile(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.${stamp}.bak`;
  await copyFile(filePath, backupPath);
  return backupPath;
}

function generateToken() {
  return randomBytes(24).toString('hex');
}

export function ensureGatewayToken(config) {
  const existing = config?.gateway?.auth?.token;
  if (existing && typeof existing === 'string') {
    return { config, token: existing };
  }

  const token = generateToken();
  const next = structuredClone(config ?? {});
  next.gateway ??= {};
  next.gateway.mode ??= 'local';
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

function selectPrimaryModel(nextConfig, providerId, catalog, selectedModelId) {
  const currentPrimary = nextConfig?.agents?.defaults?.model?.primary;
  const validRefs = new Set(catalog.map((model) => toOpenClawModelRef(providerId, model.unifiedModelId)));

  if (currentPrimary && validRefs.has(currentPrimary)) {
    return currentPrimary;
  }

  if (selectedModelId) {
    return toOpenClawModelRef(providerId, selectedModelId);
  }

  const firstCatalogModel = catalog[0]?.unifiedModelId;
  return firstCatalogModel ? toOpenClawModelRef(providerId, firstCatalogModel) : currentPrimary ?? null;
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
    models: Array.isArray(existingProvider.models) ? existingProvider.models : [],
  };

  next.gateway ??= {};
  next.gateway.mode ??= 'local';

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
