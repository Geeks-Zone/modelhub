import { homedir } from 'node:os';
import path from 'node:path';

function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

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
  return trimTrailingSlashes(String(input ?? '').trim());
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

export function toOpenClawModelRef(providerId, backendModelId) {
  return `${providerId}/${backendModelId}`;
}

function normalizeModelRefPart(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function toConfiguredModelRef(providerId, modelId) {
  const normalizedProviderId = normalizeModelRefPart(providerId);
  const normalizedModelId = normalizeModelRefPart(modelId);
  if (!normalizedProviderId || !normalizedModelId) {
    return '';
  }

  const prefix = `${normalizedProviderId}/`;
  return normalizedModelId.startsWith(prefix) ? normalizedModelId : `${prefix}${normalizedModelId}`;
}

export function extractConfiguredModels(config) {
  const providers = config?.models?.providers;
  if (!providers || typeof providers !== 'object') {
    return [];
  }

  const models = [];
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!Array.isArray(provider?.models)) {
      continue;
    }

    for (const model of provider.models) {
      const backendId = normalizeModelRefPart(model?.id);
      const modelRef = toConfiguredModelRef(providerId, backendId);
      if (!backendId || !modelRef) {
        continue;
      }

      models.push({
        backendId,
        id: modelRef,
        input: Array.isArray(model.input) ? model.input : ['text'],
        name: model.name || model.alias || backendId,
        providerId,
        reasoning: Boolean(model.reasoning),
      });
    }
  }

  return models;
}

export function normalizeConfiguredModelRef(config, modelRef) {
  const normalizedModelRef = normalizeModelRefPart(modelRef);
  if (!normalizedModelRef) {
    return '';
  }

  const configuredModels = extractConfiguredModels(config);
  const exactMatch = configuredModels.find((model) => model.id === normalizedModelRef);
  if (exactMatch) {
    return exactMatch.id;
  }

  const backendMatch = configuredModels.find((model) => model.backendId === normalizedModelRef);
  return backendMatch?.id || normalizedModelRef;
}

export function findConfiguredModel(config, modelRef) {
  const normalizedModelRef = normalizeModelRefPart(modelRef);
  if (!normalizedModelRef) {
    return null;
  }

  const configuredModels = extractConfiguredModels(config);
  return configuredModels.find((model) => (
    model.id === normalizedModelRef
    || model.backendId === normalizedModelRef
  )) || null;
}

const OPENCLAW_ALLOWED_INPUT_TYPES = new Set(['text', 'image']);

export function sanitizeModelInputTypes(input) {
  if (!Array.isArray(input)) {
    return ['text'];
  }

  const filtered = [...new Set(
    input
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => OPENCLAW_ALLOWED_INPUT_TYPES.has(value)),
  )];
  return filtered.length > 0 ? filtered : ['text'];
}

function sanitizeOpenClawModelCompat(compat) {
  if (!compat || typeof compat !== 'object' || Array.isArray(compat)) {
    return undefined;
  }

  const next = {};
  if (typeof compat.supportsTools === 'boolean') {
    next.supportsTools = compat.supportsTools;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function sanitizeOpenClawProviderModel(model) {
  const id = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!id) {
    return null;
  }

  const next = {
    id,
    input: sanitizeModelInputTypes(model.input),
    name: typeof model?.name === 'string' && model.name.trim() ? model.name : id,
    reasoning: Boolean(model?.reasoning),
  };

  if (Number.isFinite(model?.contextWindow) && model.contextWindow > 0) {
    next.contextWindow = model.contextWindow;
  }

  if (Number.isFinite(model?.maxTokens) && model.maxTokens > 0) {
    next.maxTokens = model.maxTokens;
  }

  const compat = sanitizeOpenClawModelCompat(model?.compat);
  if (compat) {
    next.compat = compat;
  }

  return next;
}

export function sanitizeProviderModels(models) {
  if (!Array.isArray(models)) {
    return [];
  }

  return models
    .map((model) => sanitizeOpenClawProviderModel(model))
    .filter(Boolean);
}

function inferInputTypes(model) {
  const inputs = ['text'];
  if (model?.capabilities?.images) {
    inputs.push('image');
  }
  return inputs;
}

export function toOpenClawProviderModel(model) {
  const name = (typeof model?.name === 'string' && model.name.trim()) || model.unifiedModelId;
  return sanitizeOpenClawProviderModel({
    id: model.unifiedModelId,
    input: inferInputTypes(model),
    name,
    reasoning: model?.capabilities?.reasoning !== 'none',
    ...(Number.isFinite(model?.contextWindow) && model.contextWindow > 0 ? { contextWindow: model.contextWindow } : {}),
    ...(Number.isFinite(model?.maxTokens) && model.maxTokens > 0 ? { maxTokens: model.maxTokens } : {}),
  });
}

export function buildProviderConfig({ apiKey, catalog, serviceBaseUrl, useEnvVar = false }) {
  return {
    api: 'openai-completions',
    apiKey: useEnvVar ? '${MODELHUB_API_KEY}' : apiKey,
    baseUrl: buildProviderBaseUrl(serviceBaseUrl),
    models: catalog.map(toOpenClawProviderModel),
  };
}
