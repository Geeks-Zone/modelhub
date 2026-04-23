import { createInterface } from 'node:readline';

export function isEnvVarRef(value) {
  return typeof value === 'string' && /^\$\{(\w+)\}$/.test(value);
}

export function resolveEnvVarRef(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const match = value.match(/^\$\{(\w+)\}$/);
  if (!match) {
    return value;
  }
  return process.env[match[1]] || '';
}

export function resolveCredentials(flags, config, providerId = 'modelhub') {
  const providerConfig = config?.models?.providers?.[providerId] ?? {};
  const configApiKeyValue = typeof providerConfig.apiKey === 'string' ? providerConfig.apiKey : '';
  const configGatewayTokenValue = typeof config?.gateway?.auth?.token === 'string' ? config.gateway.auth.token : '';

  const apiKeySource = flags['api-key']
    ? 'flag'
    : process.env.MODELHUB_API_KEY
      ? 'env'
      : configApiKeyValue
        ? (isEnvVarRef(configApiKeyValue) ? 'config-env-ref' : 'config')
        : 'missing';

  const gatewayTokenSource = flags.token
    ? 'flag'
    : process.env.OPENCLAW_GATEWAY_TOKEN
      ? 'env'
      : configGatewayTokenValue
        ? (isEnvVarRef(configGatewayTokenValue) ? 'config-env-ref' : 'config')
        : 'missing';

  const apiKey = String(
    flags['api-key']
      || process.env.MODELHUB_API_KEY
      || resolveEnvVarRef(configApiKeyValue)
      || '',
  );

  const gatewayToken = String(
    flags.token
      || process.env.OPENCLAW_GATEWAY_TOKEN
      || resolveEnvVarRef(configGatewayTokenValue)
      || '',
  );

  return {
    apiKey,
    apiKeyConfigValue: configApiKeyValue,
    apiKeySource,
    gatewayToken,
    gatewayTokenConfigValue: configGatewayTokenValue,
    gatewayTokenSource,
  };
}

export function derivePersistedApiKeyValue({ apiKey, apiKeyConfigValue, source }) {
  if (!apiKey) {
    return apiKeyConfigValue || '';
  }
  if (isEnvVarRef(apiKeyConfigValue)) {
    return apiKeyConfigValue;
  }
  if (source === 'env') {
    return '${MODELHUB_API_KEY}';
  }
  return apiKey;
}

export async function promptForApiKey() {
  if (!process.stdin.isTTY) {
    return '';
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Cole sua API Key do ModelHub: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function validateApiKey(serviceBaseUrl, apiKey) {
  try {
    const res = await fetch(`${serviceBaseUrl}/openclaw/status`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
