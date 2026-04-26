import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import {
  normalizeServiceBaseUrl,
  parseFlags,
  resolveOpenClawConfigPath,
} from './utils.mjs';
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
  selectPrimaryModelRef,
  upsertRuntimeConfig,
} from './config-merge.mjs';
import {
  resolveOpenClawBin,
  ensureGateway,
  formatResolvedCommand,
} from './gateway-manager.mjs';
import { GatewayClient } from './gateway-client.mjs';
import { BridgeWSServer } from './bridge-ws.mjs';
import {
  corsHeaders,
  ensureModelHubPrefix,
  extractBearerToken,
  isOriginAllowed,
  probeGatewayHttp,
  requestJson,
  timingSafeEqualToken,
} from './bridge-shared.mjs';

const DEFAULT_BRIDGE_PORT = 18790;
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_SERVICE_BASE_URL = 'https://www.modelhub.com.br';
const BRIDGE_REQUEST_FAILED_MESSAGE = 'Bridge request failed';
const BRIDGE_PROBE_TIMEOUT_MS = 3000;

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

async function probeBridgeStatus(bridgePort) {
  try {
    const res = await fetch(`http://127.0.0.1:${bridgePort}/api/status`, {
      signal: AbortSignal.timeout(BRIDGE_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return null;
    }

    const payload = await res.json().catch(() => null);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function isHealthyBridgeStatus(payload, { bridgePort, gatewayPort } = {}) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const bridgeStatus = payload.bridge;
  const gatewayStatus = payload.gateway;
  if (bridgeStatus?.status !== 'ok') {
    return false;
  }
  if (bridgePort && Number(bridgeStatus?.port) !== Number(bridgePort)) {
    return false;
  }
  if (gatewayPort && Number(gatewayStatus?.port) !== Number(gatewayPort)) {
    return false;
  }

  return gatewayStatus?.ok === true;
}

function isUsableOpenClawManifest(payload) {
  return payload
    && typeof payload === 'object'
    && Array.isArray(payload?.catalog?.models);
}

function catalogPayloadFromManifest(payload) {
  const catalog = payload?.catalog ?? {};
  return {
    generatedAt: payload?.generatedAt,
    models: Array.isArray(catalog.models) ? catalog.models : [],
    presets: Array.isArray(catalog.presets) ? catalog.presets : [],
    summary: catalog.summary ?? payload?.coverage ?? {},
  };
}

async function requestOpenClawManifest(serviceBaseUrl, options = {}) {
  const result = await requestJson(serviceBaseUrl, '/openclaw/manifest', options);
  if (result.ok && isUsableOpenClawManifest(result.payload)) {
    return result;
  }
  return { ...result, ok: false };
}

async function requestOpenClawCatalog(serviceBaseUrl, options = {}) {
  const manifest = await requestOpenClawManifest(serviceBaseUrl, options);
  if (manifest.ok) {
    return {
      ok: true,
      payload: catalogPayloadFromManifest(manifest.payload),
      status: manifest.status,
    };
  }
  return requestJson(serviceBaseUrl, '/openclaw/catalog', options);
}

async function listenBridgeServer(server, bridgePort) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off('error', handleError);
      resolve();
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(bridgePort, '127.0.0.1');
  });
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

  const nextBody = body && typeof body === 'object' ? structuredClone(body) : {};
  if (typeof nextBody.model === 'string' && nextBody.model) {
    nextBody.model = ensureModelHubPrefix(nextBody.model);
  }

  const upstream = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
    body: JSON.stringify(nextBody),
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
  let apiKeyRefreshPromise = null;

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

  let persistedApiKeyValue = derivePersistedApiKeyValue({
    apiKey,
    apiKeyConfigValue: resolvedCredentials.apiKeyConfigValue,
    source: apiKeySource,
  });

  if (apiKey && apiKeySource !== 'prompt') {
    const valid = await validateApiKey(serviceBaseUrl, apiKey);
    if (!valid) {
      console.error('');
      console.error('ModelHub: API Key salva ausente ou invalida.');
      if (apiKeySource === 'config') {
        console.error(`A chave salva em ${configPath} foi rejeitada pelo ModelHub.`);
      } else if (apiKeySource === 'config-env-ref') {
        console.error(`A variavel referenciada em ${configPath} foi rejeitada pelo ModelHub.`);
      } else if (apiKeySource === 'env') {
        console.error('A chave em MODELHUB_API_KEY foi rejeitada pelo ModelHub.');
      } else if (apiKeySource === 'flag') {
        console.error('A chave informada em --api-key foi rejeitada pelo ModelHub.');
      }

      if (!process.stdin.isTTY) {
        console.error('Rode novamente com --api-key ou exporte MODELHUB_API_KEY com uma chave valida.');
        process.exitCode = 1;
        return;
      }

      while (true) {
        const nextApiKey = await promptForApiKey();
        if (!nextApiKey) {
          console.error('Atualizacao da API Key cancelada.');
          process.exitCode = 1;
          return;
        }

        const nextValid = await validateApiKey(serviceBaseUrl, nextApiKey);
        if (!nextValid) {
          console.error('API Key invalida. Tente novamente.');
          continue;
        }

        apiKey = nextApiKey;
        apiKeySource = 'prompt';
        persistedApiKeyValue = nextApiKey;
        console.log('API Key validada.');
        break;
      }
    }
  }

  async function syncCatalogConfig(currentApiKey) {
    try {
      const catalogResult = await requestOpenClawCatalog(serviceBaseUrl, { apiKey: currentApiKey });
      if (!catalogResult.ok || !Array.isArray(catalogResult.payload?.models) || catalogResult.payload.models.length === 0) {
        return false;
      }

      const catalog = catalogResult.payload.models;
      const presets = Array.isArray(catalogResult.payload?.presets) ? catalogResult.payload.presets : [];
      const codingPresetModel = presets.find((preset) => preset.preset === 'coding')?.model || '';
      const currentPrimary = config?.agents?.defaults?.model?.primary;

      // Selecao unificada — antes ha tres locais que disputavam essa decisao.
      const primary = selectPrimaryModelRef({
        catalog,
        currentPrimary,
        preferredModelId: '',
        providerId,
        selectedModelId: codingPresetModel,
      });

      const fallbacks = presets
        .map((preset) => (preset.model ? ensureModelHubPrefix(preset.model) : ''))
        .filter((ref) => ref && ref !== primary);

      // Passamos o id (sem prefixo) ao mergeConfig — ele aplica selectPrimaryModelRef
      // internamente respeitando o que ja existir no config.
      const primaryBackendId = typeof primary === 'string' && primary.startsWith(`${providerId}/`)
        ? primary.slice(providerId.length + 1)
        : '';

      const next = mergeConfig(config, {
        apiKeyValue: persistedApiKeyValue,
        catalog,
        providerId,
        selectedModelId: primaryBackendId,
        serviceBaseUrl,
      });
      next.agents ??= {};
      next.agents.defaults ??= {};
      next.agents.defaults.model = {
        ...(typeof next.agents.defaults.model === 'object' ? next.agents.defaults.model : {}),
        ...(primary ? { primary } : {}),
        fallbacks,
      };

      config = next;
      await persistConfig(config);
      log.info(`Config sincronizada com ${catalog.length} modelos (modelo primario: ${primary || 'nenhum'})`);
      return true;
    } catch (error) {
      log.warn(`Catalog sync failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function promptForRuntimeApiKey(reason) {
    if (apiKeyRefreshPromise) {
      return apiKeyRefreshPromise;
    }

    apiKeyRefreshPromise = (async () => {
      console.error('');
      console.error('ModelHub: autenticacao invalida durante o chat.');
      if (reason) {
        console.error(`Detalhe: ${reason}`);
      }

      if (!process.stdin.isTTY) {
        console.error('Nao foi possivel pedir uma nova API Key neste terminal.');
        console.error('Rode novamente com --api-key ou exporte MODELHUB_API_KEY.');
        return false;
      }

      while (true) {
        const nextApiKey = await promptForApiKey();
        if (!nextApiKey) {
          console.error('Atualizacao da API Key cancelada.');
          return false;
        }

        const valid = await validateApiKey(serviceBaseUrl, nextApiKey);
        if (!valid) {
          console.error('API Key invalida. Tente novamente.');
          continue;
        }

        apiKey = nextApiKey;
        apiKeySource = 'prompt';
        persistedApiKeyValue = nextApiKey;
        config = upsertRuntimeConfig(config, {
          apiKeyValue: persistedApiKeyValue,
          providerId,
          serviceBaseUrl,
        });
        config.gateway ??= {};
        config.gateway.auth = {
          ...(typeof config.gateway.auth === 'object' && config.gateway.auth ? config.gateway.auth : {}),
          mode: 'token',
          token: gatewayToken,
        };
        await persistConfig(config);
        await syncCatalogConfig(apiKey);
        console.log('API Key do ModelHub atualizada. Reenvie a mensagem.');
        return true;
      }
    })().finally(() => {
      apiKeyRefreshPromise = null;
    });

    return apiKeyRefreshPromise;
  }

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
  await syncCatalogConfig(apiKey);

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

  const gatewayClient = new GatewayClient(`http://127.0.0.1:${gatewayPort}`, gatewayToken, log);
  gatewayClient.connect().then(() => {
    log.info('[gw] WS connected');
  }).catch((error) => {
    log.warn(`[gw] WS not connected: ${error instanceof Error ? error.message : String(error)}`);
  });

  const configManager = {
    bridgeId,
    gatewayToken,
    changeModel: async (modelRef) => {
      const normalizedModelRef = ensureModelHubPrefix(modelRef);
      const next = structuredClone(config);
      next.agents ??= {};
      next.agents.defaults ??= {};
      next.agents.defaults.model = {
        ...(typeof next.agents.defaults.model === 'object' ? next.agents.defaults.model : {}),
        primary: normalizedModelRef,
      };
      await persistConfig(next);
      config = next;
    },
    getConfig: () => config,
    getPrimaryModel: () => config?.agents?.defaults?.model?.primary ?? null,
    handleAuthError: async ({ error }) => promptForRuntimeApiKey(error),
  };

  const bridgeWs = new BridgeWSServer(gatewayClient, configManager, log);

  const requireBridgeAuth = (req, res, origin) => {
    const provided = extractBearerToken(req.headers.authorization);
    if (!provided || !timingSafeEqualToken(provided, gatewayToken)) {
      jsonResponse(res, { error: 'Unauthorized' }, 401, origin);
      return false;
    }
    return true;
  };

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const url = new URL(req.url, `http://127.0.0.1:${bridgePort}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    if (origin && !isOriginAllowed(origin)) {
      jsonResponse(res, { error: 'Forbidden origin' }, 403, origin);
      return;
    }

    try {
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const gatewayOk = gatewayClient.connected || await probeGatewayHttp(gatewayPort);
        jsonResponse(res, {
          bridge: {
            bridgeId,
            port: bridgePort,
            status: 'ok',
          },
          gateway: {
            base: `http://127.0.0.1:${gatewayPort}`,
            ok: gatewayOk,
            port: gatewayPort,
            status: gatewayClient.status,
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
        try {
          const catalogResult = await requestOpenClawCatalog(serviceBaseUrl, { apiKey });
          if (catalogResult.ok && Array.isArray(catalogResult.payload?.models)) {
            const models = catalogResult.payload.models.map((model) => ({
              id: `modelhub/${model.unifiedModelId}`,
              name: model.name,
              primary: `modelhub/${model.unifiedModelId}` === currentPrimary,
              providerId: model.providerId,
            }));
            jsonResponse(res, { models }, 200, origin);
            return;
          }
        } catch {
          // fallback to empty list
        }
        jsonResponse(res, { models: currentPrimary ? [{ id: currentPrimary, name: currentPrimary, primary: true }] : [] }, 200, origin);
        return;
      }

      if (url.pathname === '/v1/models' && req.method === 'GET') {
        try {
          const catalogResult = await requestOpenClawCatalog(serviceBaseUrl, { apiKey });
          if (catalogResult.ok && Array.isArray(catalogResult.payload?.models)) {
            jsonResponse(res, {
              data: catalogResult.payload.models.map((model) => ({
                created: Math.floor(Date.now() / 1000),
                id: `modelhub/${model.unifiedModelId}`,
                name: model.name,
                object: 'model',
                owned_by: model.providerId || 'unknown',
              })),
              object: 'list',
            }, 200, origin);
            return;
          }
        } catch {
          // fallback
        }
        jsonResponse(res, { data: [], object: 'list' }, 200, origin);
        return;
      }

      if ((url.pathname === '/api/model' || url.pathname === '/api/config/model') && req.method === 'POST') {
        if (!requireBridgeAuth(req, res, origin)) return;
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

        const normalizedModelRef = ensureModelHubPrefix(modelRef);
        await configManager.changeModel(normalizedModelRef);
        await bridgeWs.patchAllKnownSessions(normalizedModelRef);
        jsonResponse(res, { model: normalizedModelRef, ok: true }, 200, origin);
        return;
      }

      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        if (!requireBridgeAuth(req, res, origin)) return;
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
      const message = error instanceof Error ? error.message : BRIDGE_REQUEST_FAILED_MESSAGE;
      const status = /^Modelo ".+" nao esta configurado nesta integracao local\b/.test(message)
        || message === 'Nenhum modelo OpenClaw foi configurado para esta integracao local.'
        ? 400
        : 502;
      log.error('[bridge] request failed', error);
      jsonResponse(res, { error: message || BRIDGE_REQUEST_FAILED_MESSAGE }, status, origin);
    }
  });

  await bridgeWs.attach(server);

  try {
    await listenBridgeServer(server, bridgePort);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      const existingBridge = await probeBridgeStatus(bridgePort);
      if (isHealthyBridgeStatus(existingBridge, { bridgePort, gatewayPort })) {
        log.info(`Bridge: attach em 127.0.0.1:${bridgePort} (saudavel)`);
        console.log(`OpenClaw pronto em http://127.0.0.1:${bridgePort}`);
        console.log('');
        console.log('Integracao local ja ativa.');
        await bridgeWs.close();
        gatewayClient.dispose();
        if (gatewayResult?.mode === 'own' && gatewayResult.child) {
          gatewayResult.child.kill();
        }
        return;
      }

      console.error(`Porta ${bridgePort} em uso. Use --bridge-port para outra porta.`);
    } else {
      console.error(`Erro na integracao local: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!gatewayClient.connected) {
    log.warn('[gw] Bridge HTTP is ready while gateway WS is still connecting; initial requests may wait for connect().');
  }

  console.log(`OpenClaw pronto em http://127.0.0.1:${bridgePort}`);
  console.log('');
  console.log('Integracao local ativa. Ctrl+C para parar.');

  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down...');
    try {
      await bridgeWs.close();
    } catch (error) {
      log.debug('[bridge] close error:', error instanceof Error ? error.message : String(error));
    }
    try {
      gatewayClient.dispose();
    } catch (error) {
      log.debug('[gw] dispose error:', error instanceof Error ? error.message : String(error));
    }
    if (gatewayResult?.mode === 'own' && gatewayResult.child) {
      try {
        gatewayResult.child.kill();
      } catch {
        // gateway pode ja ter encerrado
      }
    }
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    process.exit(0);
  };

  process.on('SIGINT', () => { void cleanup(); });
  process.on('SIGTERM', () => { void cleanup(); });
}
