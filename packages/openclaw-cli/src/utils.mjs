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
    name: model.alias || `${model.name} (${model.providerId})`,
    reasoning: model?.capabilities?.reasoning !== 'none',
  };

  if (Number.isFinite(model.contextWindow) && model.contextWindow > 0) {
    out.contextWindow = model.contextWindow;
  }

  if (Number.isFinite(model.maxTokens) && model.maxTokens > 0) {
    out.maxTokens = model.maxTokens;
  }

  return out;
}

export function buildProviderConfig({ apiKey, catalog, serviceBaseUrl, useEnvVar = false }) {
  return {
    api: 'openai-completions',
    apiKey: useEnvVar ? '${MODELHUB_API_KEY}' : apiKey,
    baseUrl: buildProviderBaseUrl(serviceBaseUrl),
    models: catalog.map(toOpenClawProviderModel),
  };
}
