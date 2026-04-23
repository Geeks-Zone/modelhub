import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { parseFlags, resolveOpenClawConfigPath, normalizeServiceBaseUrl } from './utils.mjs';
import { createLogger, resolveLogLevel } from './logger.mjs';
import {
  resolveCredentials,
  promptForApiKey,
  validateApiKey,
  derivePersistedApiKeyValue,
} from './credentials.mjs';
import {
  loadJsonFile,
  writeJsonFile,
  backupJsonFile,
  ensureGatewayToken,
  mergeConfig,
  upsertRuntimeConfig,
} from './config-merge.mjs';
import {
  resolveOpenClawBin,
  ensureGateway,
  formatResolvedCommand,
} from './gateway-manager.mjs';
import { GatewayClient } from './gateway-client.mjs';
import { BridgeWSServer } from './bridge-ws.mjs';

const DEFAULT_BRIDGE_PORT = 18790;
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_SERVICE_BASE_URL = 'https://www.modelhub.com.br';
const ALLOWED_HTTP_ORIGINS = [
  'https://www.modelhub.com.br',
  'https://modelhub.com.br',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && ALLOWED_HTTP_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    headers['Access-Control-Allow-Origin'] = ALLOWED_HTTP_ORIGINS[0];
  }
  return headers;
}

function jsonResponse(res, data, status = 200, origin) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json',
    ...corsHeaders(origin),
  });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extractModelsFromConfig(config) {
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
      if (!model?.id) {
        continue;
      }
      models.push({
        id: model.id,
        input: Array.isArray(model.input) ? model.input : ['text'],
        name: model.name || model.alias || model.id,
        providerId,
        reasoning: Boolean(model.reasoning),
      });
    }
  }
  return models;
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

async function probeGatewayStatus(gatewayPort, gatewayToken) {
  let ok = false;
  try {
    const health = await fetch(`http://127.0.0.1:${gatewayPort}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!health.ok) {
      return false;
    }
    const models = await fetch(`http://127.0.0.1:${gatewayPort}/v1/models`, {
      headers: gatewayToken ? { authorization: `Bearer ${gatewayToken}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    ok = models.ok;
  } catch {
    ok = false;
  }
  return ok;
}

async function proxyGatewayChatCompletions({ gatewayPort, gatewayToken, origin, req, res, body, log }) {
  const controller = new AbortController();
  req.on('close', () => {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  });

  const upstream = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
    body: JSON.stringify(body),
    headers: {
      authorization: gatewayToken ? `Bearer ${gatewayToken}` : '',
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: controller.signal,
  });

  const contentType = upstream.headers.get('content-type') || 'application/json';
  const responseHeaders = {
    'Content-Type': contentType,
    ...corsHeaders(origin),
  };

  if (!upstream.body) {
    const text = await upstream.text();
    res.writeHead(upstream.status, responseHeaders);
    res.end(text);
    return;
  }

  if (contentType.includes('text/event-stream')) {
    res.writeHead(upstream.status, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...responseHeaders,
    });
  } else {
    res.writeHead(upstream.status, responseHeaders);
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      res.write(value);
    }
    res.end();
  } catch (error) {
    log.debug('[bridge] upstream proxy interrupted:', error instanceof Error ? error.message : String(error));
    if (!res.writableEnded) {
      res.end();
    }
  } finally {
    reader.releaseLock();
  }
}

export async function run(args) {
  const { flags } = parseFlags(args);
  const log = createLogger(resolveLogLevel(flags));
  const bridgeId = randomUUID();
  const providerId = 'modelhub';
  const configPath = resolveOpenClawConfigPath(process.env);
  const bridgePort = Number(flags['bridge-port'] || flags.p || DEFAULT_BRIDGE_PORT);
  const gatewayPort = Number(flags['gateway-port'] || flags.gp || DEFAULT_GATEWAY_PORT);
  const serviceBaseUrl = normalizeServiceBaseUrl(
    flags['base-url'] || process.env.MODELHUB_BASE_URL || DEFAULT_SERVICE_BASE_URL,
  );

  log.info(`Config: ${configPath}`);
  log.info(`Bridge port: ${bridgePort}, Gateway port: ${gatewayPort}`);

  let config = await loadJsonFile(configPath);
  let backupCreated = false;
  async function persistConfig(nextConfig, { createBackup = false } = {}) {
    config = nextConfig;
    if (createBackup && !backupCreated) {
      await backupJsonFile(configPath);
      backupCreated = true;
    }
    await writeJsonFile(configPath, config);
  }

  const resolvedCredentials = resolveCredentials(flags, config, providerId);
  let apiKey = resolvedCredentials.apiKey;
  let apiKeySource = resolvedCredentials.apiKeySource;
  let gatewayToken = resolvedCredentials.gatewayToken;

  if (!apiKey) {
    const interactiveKey = await promptForApiKey();
    if (!interactiveKey) {
      console.error('Nenhuma credencial encontrada.');
      console.error('');
      console.error('  Opcao 1: Configure via terminal');
      console.error('    npx @model-hub/openclaw-cli run --api-key <sua-key>');
      console.error('');
      console.error('  Opcao 2: Exporte no shell');
      console.error('    MODELHUB_API_KEY=<sua-key> npx @model-hub/openclaw-cli run');
      process.exitCode = 1;
      return;
    }

    const valid = await validateApiKey(serviceBaseUrl, interactiveKey);
    if (!valid) {
      console.error('API Key invalida. Verifique e tente novamente.');
      process.exitCode = 1;
      return;
    }

    apiKey = interactiveKey;
    apiKeySource = 'prompt';
    console.log('API Key validada.');
  }

  const persistedApiKeyValue = derivePersistedApiKeyValue({
    apiKey,
    apiKeyConfigValue: resolvedCredentials.apiKeyConfigValue,
    source: apiKeySource,
  });

  const tokenResult = ensureGatewayToken(config);
  config = upsertRuntimeConfig(tokenResult.config, {
    apiKeyValue: persistedApiKeyValue,
    providerId,
    serviceBaseUrl,
  });
  gatewayToken = gatewayToken || tokenResult.token;
  config.gateway ??= {};
  config.gateway.auth = {
    ...(typeof config.gateway.auth === 'object' && config.gateway.auth ? config.gateway.auth : {}),
    mode: 'token',
    token: gatewayToken,
  };
  await persistConfig(config, { createBackup: true });

  const bin = resolveOpenClawBin(flags);
  log.info(`Binario: ${formatResolvedCommand(bin)}`);

  let gatewayResult;
  try {
    gatewayResult = await ensureGateway({ bin, log, port: gatewayPort, token: gatewayToken });
  } catch (error) {
    console.error(`Gateway: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  try {
    const catalogResult = await requestJson(serviceBaseUrl, '/openclaw/catalog', { apiKey });
    if (catalogResult.ok && Array.isArray(catalogResult.payload?.models) && catalogResult.payload.models.length > 0) {
      const catalog = catalogResult.payload.models;
      const currentPrimary = config?.agents?.defaults?.model?.primary;
      const currentBackendModel = typeof currentPrimary === 'string' && currentPrimary.startsWith('modelhub/')
        ? currentPrimary.slice('modelhub/'.length)
        : '';
      const selectedModelId = currentBackendModel && catalog.some((model) => model.unifiedModelId === currentBackendModel)
        ? currentBackendModel
        : catalogResult.payload.presets?.find((preset) => preset.preset === 'coding')?.model || catalog[0]?.unifiedModelId || '';

      config = mergeConfig(config, {
        apiKeyValue: persistedApiKeyValue,
        catalog,
        providerId,
        selectedModelId,
        serviceBaseUrl,
      });
      await persistConfig(config);
      log.info(`Config sincronizada com ${catalog.length} modelos`);
    }
  } catch (error) {
    log.warn(`Catalog sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const gatewayClient = new GatewayClient(`http://127.0.0.1:${gatewayPort}`, gatewayToken, log);
  gatewayClient.connect().then(() => {
    log.info('[gw] WS connected');
  }).catch((error) => {
    log.warn(`[gw] WS not connected: ${error instanceof Error ? error.message : String(error)}`);
  });

  const configManager = {
    bridgeId,
    changeModel: async (modelRef) => {
      const next = structuredClone(config);
      next.agents ??= {};
      next.agents.defaults ??= {};
      next.agents.defaults.model = {
        ...(typeof next.agents.defaults.model === 'object' ? next.agents.defaults.model : {}),
        primary: modelRef,
      };
      await persistConfig(next);
    },
    getConfig: () => config,
    getPrimaryModel: () => config?.agents?.defaults?.model?.primary ?? null,
  };

  const bridgeWs = new BridgeWSServer(gatewayClient, configManager, log);

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const url = new URL(req.url, `http://127.0.0.1:${bridgePort}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    try {
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const models = extractModelsFromConfig(config);
        const gatewayOk = gatewayClient.connected || await probeGatewayStatus(gatewayPort, gatewayToken);
        jsonResponse(res, {
          bridge: {
            bridgeId,
            port: bridgePort,
            status: 'ok',
          },
          gateway: {
            base: `http://127.0.0.1:${gatewayPort}`,
            models: models.length,
            ok: gatewayOk,
            port: gatewayPort,
            ws: gatewayClient.connected,
          },
          model: {
            primary: config?.agents?.defaults?.model?.primary ?? null,
          },
        }, 200, origin);
        return;
      }

      if (url.pathname === '/api/models' && req.method === 'GET') {
        const currentPrimary = config?.agents?.defaults?.model?.primary ?? null;
        jsonResponse(res, {
          models: extractModelsFromConfig(config).map((model) => ({
            ...model,
            primary: model.id === currentPrimary,
          })),
        }, 200, origin);
        return;
      }

      if (url.pathname === '/v1/models' && req.method === 'GET') {
        const models = extractModelsFromConfig(config);
        jsonResponse(res, {
          data: models.map((model) => ({
            created: Math.floor(Date.now() / 1000),
            id: model.id,
            name: model.name,
            object: 'model',
            owned_by: model.providerId || model.id.split('/')[0] || 'unknown',
          })),
          object: 'list',
        }, 200, origin);
        return;
      }

      if ((url.pathname === '/api/model' || url.pathname === '/api/config/model') && req.method === 'POST') {
        const body = await readBody(req);
        let parsed;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          jsonResponse(res, { error: 'Invalid JSON' }, 400, origin);
          return;
        }

        const modelRef = parsed.model || parsed.primary;
        if (!modelRef || typeof modelRef !== 'string') {
          jsonResponse(res, { error: 'Missing "model"' }, 400, origin);
          return;
        }

        await configManager.changeModel(modelRef);
        await bridgeWs.patchAllKnownSessions(modelRef);
        jsonResponse(res, { model: modelRef, ok: true }, 200, origin);
        return;
      }

      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        const body = await readBody(req);
        let parsed;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          jsonResponse(res, { error: 'Invalid JSON' }, 400, origin);
          return;
        }

        await proxyGatewayChatCompletions({
          body: parsed,
          gatewayPort,
          gatewayToken,
          log,
          origin,
          req,
          res,
        });
        return;
      }

      jsonResponse(res, {
        error: 'Not found',
        paths: ['/api/status', '/api/models', '/api/model', '/api/config/model', '/v1/models', '/v1/chat/completions'],
      }, 404, origin);
    } catch (error) {
      jsonResponse(res, { error: error instanceof Error ? error.message : String(error) }, 502, origin);
    }
  });

  await bridgeWs.attach(server);

  server.listen(bridgePort, '127.0.0.1', () => {
    console.log(`OpenClaw pronto em http://127.0.0.1:${bridgePort}`);
    console.log('');
    console.log('Bridge ativo. Ctrl+C para parar.');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Porta ${bridgePort} em uso. Use --bridge-port para outra porta.`);
    } else {
      console.error(`Erro no bridge: ${error.message}`);
    }
    process.exitCode = 1;
  });

  const cleanup = async () => {
    log.info('Shutting down...');
    await bridgeWs.close();
    gatewayClient.dispose();
    if (gatewayResult?.mode === 'own' && gatewayResult.child) {
      gatewayResult.child.kill();
    }
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => { void cleanup(); });
  process.on('SIGTERM', () => { void cleanup(); });
}
