import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveOpenClawConfigPath } from './index.mjs';

const DEFAULT_BRIDGE_PORT = 18790;
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_MODELHUB_PORT = 3000;
const ALLOWED_ORIGINS = [
  'https://www.modelhub.com.br',
  'https://modelhub.com.br',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const BRIDGE_REQUEST_FAILED_MESSAGE = 'Bridge request failed';
const BRIDGE_PROXY_FAILED_MESSAGE = 'Proxy error';

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGINS[0];
  }
  return headers;
}

function jsonResponse(res, data, status = 200, origin) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
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
  const models = [];
  const providers = config.models?.providers;
  if (!providers || typeof providers !== 'object') return models;

  for (const provider of Object.values(providers)) {
    if (!provider || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!model || typeof model.id !== 'string') continue;
      models.push({
        id: model.id,
        name: model.name || model.id,
        ...(model.input ? { input: model.input } : {}),
        ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
      });
    }
  }

  return models;
}

async function changeModel(configPath, modelRef) {
  let config = {};
  try {
    const raw = await readFile(configPath, 'utf8');
    config = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Config file not found or invalid JSON' };
  }

  config.agents ??= {};
  config.agents.defaults ??= {};
  const currentModel = config.agents.defaults.model && typeof config.agents.defaults.model === 'object'
    ? config.agents.defaults.model
    : {};
  config.agents.defaults.model = { ...currentModel, primary: modelRef };

  try {
    const { default: pathLib } = await import('node:path');
    const dir = pathLib.dirname(configPath);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  } catch (e) {
    return { ok: false, error: e.message };
  }

  return { ok: true, model: modelRef };
}

class OpenClawWsClient {
  #ws = null;
  #gatewayUrl;
  #gatewayToken;
  #requestMap = new Map();
  #pushHandlers = new Set();
  #pendingConnect = [];
  #connected = false;
  #connectPromise = null;
  #sessionId = null;
  #reconnectTimer = null;
  #disposed = false;

  constructor(gatewayUrl, gatewayToken) {
    this.#gatewayUrl = gatewayUrl;
    this.#gatewayToken = gatewayToken;
  }

  get connected() { return this.#connected; }
  get sessionId() { return this.#sessionId; }

  async connect() {
    if (this.#connected && this.#ws?.readyState === 1) return;
    if (this.#connectPromise) return this.#connectPromise;

    this.#connectPromise = this.#doConnect();
    try {
      await this.#connectPromise;
    } finally {
      this.#connectPromise = null;
    }
  }

  async #doConnect() {
    const wsUrl = this.#gatewayUrl.replace(/^http/, 'ws');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.#ws = ws;
      let settled = false;

      const connectMsg = {
        caps: ['tool-events'],
        client: { name: 'modelhub-bridge', version: '1.1.0' },
        device: { id: `modelhub-bridge-${randomUUID().slice(0, 8)}`, name: 'ModelHub Bridge' },
        maxProtocol: 3,
        minProtocol: 3,
        role: 'client',
        ...(this.#gatewayToken ? { auth: { token: this.#gatewayToken } } : {}),
      };

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify(connectMsg));
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString()); } catch { return; }
        this.#handleMessage(msg);
        if (!settled && msg.type === 'connected') {
          settled = true;
          this.#connected = true;
          console.log('[ws] Connected to OpenClaw gateway');
          resolve();
        } else if (!settled && msg.type === 'error') {
          settled = true;
          reject(new Error(msg.error?.message || msg.message || 'Connection rejected'));
        }
      });

      ws.addEventListener('close', (event) => {
        this.#connected = false;
        this.#ws = null;
        for (const [, entry] of this.#requestMap) {
          entry.reject(new Error(`WebSocket closed: ${event.code} ${event.reason}`));
        }
        this.#requestMap.clear();
        console.log(`[ws] Disconnected (code=${event.code})`);
        if (!this.#disposed) {
          this.#scheduleReconnect();
        }
      });

      ws.addEventListener('error', (event) => {
        const errMsg = event.message || 'WebSocket error';
        if (!settled) {
          settled = true;
          reject(new Error(errMsg));
        } else {
          console.error('[ws] Error:', errMsg);
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Connection timeout'));
          ws.close();
        }
      }, 10000);
    });
  }

  #scheduleReconnect() {
    if (this.#reconnectTimer || this.#disposed) return;
    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      try {
        await this.connect();
      } catch (e) {
        console.error('[ws] Reconnect failed:', e.message);
      }
    }, 3000);
  }

  #handleMessage(msg) {
    if (msg.type === 'response' && msg.id) {
      const entry = this.#requestMap.get(msg.id);
      if (entry) {
        this.#requestMap.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          entry.resolve(msg.result ?? msg);
        }
      }
      return;
    }

    if (msg.type === 'push' || msg.type === 'session' || msg.type === 'connected') {
      for (const handler of this.#pushHandlers) {
        try { handler(msg); } catch (e) { console.error('[ws] push handler error:', e.message); }
      }
      return;
    }

    if (msg.id) {
      const entry = this.#requestMap.get(msg.id);
      if (entry) {
        this.#requestMap.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          entry.resolve(msg);
        }
      }
    }
  }

  async request(method, params = {}, timeout = 30000) {
    await this.connect();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#requestMap.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeout);
      this.#requestMap.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      const msg = { id, method, params, type: 'request' };
      this.#ws.send(JSON.stringify(msg));
    });
  }

  onPush(handler) {
    this.#pushHandlers.add(handler);
    return () => this.#pushHandlers.delete(handler);
  }

  async ensureSession() {
    if (this.#sessionId) return this.#sessionId;
    const sessions = await this.request('sessions.list');
    const list = Array.isArray(sessions) ? sessions : (sessions?.sessions ?? []);
    if (list.length > 0) {
      this.#sessionId = list[0].id || list[0].sessionId;
      return this.#sessionId;
    }
    const created = await this.request('sessions.create', {});
    this.#sessionId = created?.id || created?.sessionId || randomUUID();
    return this.#sessionId;
  }

  async setModel(modelRef) {
    const sid = await this.ensureSession();
    await this.request('sessions.patch', {
      sessionId: sid,
      model: { primary: modelRef },
    });
  }

  async sendMessage(text) {
    const sid = await this.ensureSession();
    return this.request('chat.send', {
      sessionId: sid,
      content: text,
    });
  }

  async abortRun() {
    if (!this.#sessionId) return;
    await this.request('chat.abort', { sessionId: this.#sessionId });
  }

  dispose() {
    this.#disposed = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
    this.#connected = false;
  }
}

function sseWrite(res, event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`data: ${payload}\n\n`);
}

function sseWriteVercelAiFormat(res, type, value) {
  res.write(`${type}:${JSON.stringify(value)}\n`);
}

export async function runBridge(args) {
  const { flags } = (() => {
    const parsed = { flags: {}, positionals: [] };
    for (let i = 0; i < args.length; i++) {
      const token = args[i];
      if (!token.startsWith('--')) {
        parsed.positionals.push(token);
        continue;
      }
      const withoutPrefix = token.slice(2);
      const equalsIndex = withoutPrefix.indexOf('=');
      if (equalsIndex >= 0) {
        parsed.flags[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      } else {
        const next = args[i + 1];
        if (!next || next.startsWith('--')) {
          parsed.flags[withoutPrefix] = true;
        } else {
          parsed.flags[withoutPrefix] = next;
          i++;
        }
      }
    }
    return parsed;
  })();

  const bridgePort = Number(flags.port || flags.p || DEFAULT_BRIDGE_PORT);
  const gatewayPort = Number(flags['gateway-port'] || flags.gp || DEFAULT_GATEWAY_PORT);
  const modelhubPort = Number(flags['modelhub-port'] || flags.mp || DEFAULT_MODELHUB_PORT);
  const gatewayBase = `http://127.0.0.1:${gatewayPort}`;
  const modelhubBase = `http://127.0.0.1:${modelhubPort}`;
  const env = process.env;
  const configPath = resolveOpenClawConfigPath(env);

  let gatewayToken = env.OPENCLAW_GATEWAY_TOKEN || '';
  if (flags.token || flags.t) {
    gatewayToken = String(flags.token || flags.t);
  }

  let modelhubApiKey = env.MODELHUB_API_KEY || '';
  if (flags['api-key'] || flags.k) {
    modelhubApiKey = String(flags['api-key'] || flags.k);
  }

  console.log(`ModelHub OpenClaw Bridge v1.1.0`);
  console.log(`  Bridge:     http://127.0.0.1:${bridgePort}`);
  console.log(`  Gateway:    ${gatewayBase}`);
  console.log(`  ModelHub:   ${modelhubBase}`);
  console.log(`  Config:     ${configPath}`);
  console.log(`  Token:      ${gatewayToken ? '***' : '(none)'}`);
  console.log(`  API Key:    ${modelhubApiKey ? '***' : '(none)'}\n`);

  let cachedConfig = null;
  let configMtime = 0;

  async function loadConfig() {
    try {
      const stat = await (await import('node:fs/promises')).stat(configPath);
      if (stat.mtimeMs !== configMtime) {
        const raw = await readFile(configPath, 'utf8');
        cachedConfig = JSON.parse(raw);
        configMtime = stat.mtimeMs;
      }
    } catch {
      cachedConfig = null;
      configMtime = 0;
    }
    return cachedConfig;
  }

  const wsClient = new OpenClawWsClient(gatewayBase, gatewayToken);

  wsClient.connect().then(() => {
    console.log('[bridge] WebSocket connected to OpenClaw gateway — agent tools enabled');
  }).catch((e) => {
    console.warn(`[bridge] WebSocket not connected: ${e.message}`);
    console.log('[bridge] Falling back to REST proxy mode (no agent tools). Will retry WS automatically.');
  });

  async function proxyChatToModelhub(chatBody, req, res, origin) {
    const model = String(chatBody.model || '');
    let modelhubModel = model;
    if (model.startsWith('modelhub/')) {
      modelhubModel = model.slice('modelhub/'.length);
    }

    const providerPrefix = modelhubModel.split('/')[0];
    const hasProvider = providerPrefix && providerPrefix.length > 0;

    let upstreamUrl;
    if (hasProvider) {
      upstreamUrl = `${modelhubBase}/${providerPrefix}/api/chat`;
    } else {
      upstreamUrl = `${modelhubBase}/v1/chat/completions`;
    }

    const proxyBody = { ...chatBody };
    if (modelhubModel !== model) {
      proxyBody.model = modelhubModel;
    }
    const internalBody = {
      ...proxyBody,
      modelId: modelhubModel.includes('/') ? modelhubModel.slice(modelhubModel.indexOf('/') + 1) : modelhubModel,
    };
    delete internalBody.model;

    console.log(`[bridge] REST fallback: proxying chat model=${model} -> ${upstreamUrl}`);

    const upstreamHeaders = { 'Content-Type': 'application/json' };
    const clientAuth = req.headers['authorization'];
    if (clientAuth) {
      upstreamHeaders['Authorization'] = clientAuth;
    } else if (modelhubApiKey) {
      upstreamHeaders['Authorization'] = `Bearer ${modelhubApiKey}`;
    }

    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(internalBody),
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const isStreaming = contentType.includes('event-stream');

    if (isStreaming) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...corsHeaders(origin),
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch {
          // client disconnected
        } finally {
          reader.releaseLock();
        }
      }
      res.end();
    } else {
      const responseBody = await upstream.text();
      res.writeHead(upstream.status, {
        'Content-Type': contentType,
        ...corsHeaders(origin),
      });
      res.end(responseBody);
    }
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const url = new URL(req.url, `http://127.0.0.1:${bridgePort}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    try {
      if (url.pathname === '/api/status') {
        let gatewayOk = wsClient.connected;
        if (!gatewayOk) {
          try {
            const gwRes = await fetch(`${gatewayBase}/health`);
            if (gwRes.ok) {
              const data = await gwRes.json().catch(() => null);
              gatewayOk = data && data.ok === true;
            }
          } catch {
            gatewayOk = false;
          }
        }

        const config = await loadConfig();
        const models = config ? extractModelsFromConfig(config) : [];
        const currentModel = config?.agents?.defaults?.model?.primary ?? null;

        jsonResponse(res, {
          bridge: { port: bridgePort, status: 'ok' },
          gateway: { base: gatewayBase, models: models.length, ok: gatewayOk, port: gatewayPort, ws: wsClient.connected },
          model: { primary: currentModel },
        }, 200, origin);
        return;
      }

      if (url.pathname === '/api/config/model' && req.method === 'POST') {
        const body = await readBody(req);
        let parsed;
        try {
          parsed = JSON.parse(body.toString());
        } catch {
          jsonResponse(res, { error: 'Invalid JSON' }, 400, origin);
          return;
        }

        const modelRef = parsed.model || parsed.primary;
        if (!modelRef || typeof modelRef !== 'string') {
          jsonResponse(res, { error: 'Missing "model" or "primary" field' }, 400, origin);
          return;
        }

        const fileResult = await changeModel(configPath, modelRef);
        configMtime = 0;

        if (wsClient.connected) {
          try {
            await wsClient.setModel(modelRef);
            console.log(`[bridge] Model changed via WS RPC: ${modelRef}`);
          } catch (wsErr) {
            console.warn(`[bridge] WS model change failed: ${wsErr.message}`);
          }
        }

        if (fileResult.ok) {
          jsonResponse(res, { ok: true, model: fileResult.model }, 200, origin);
        } else {
          jsonResponse(res, { ok: false, error: fileResult.error }, 500, origin);
        }
        return;
      }

      if (url.pathname === '/v1/models' && req.method === 'GET') {
        const config = await loadConfig();
        const models = config ? extractModelsFromConfig(config) : [];

        const openAiModels = models.map((m) => ({
          id: m.id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: m.id.split('/')[0] || 'unknown',
        }));

        jsonResponse(res, {
          object: 'list',
          data: openAiModels,
        }, 200, origin);
        return;
      }

      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        const body = await readBody(req);
        let chatBody;
        try {
          chatBody = JSON.parse(body.toString());
        } catch {
          jsonResponse(res, { error: 'Invalid JSON body' }, 400, origin);
          return;
        }

        const model = String(chatBody.model || '');
        const messages = Array.isArray(chatBody.messages) ? chatBody.messages : [];
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
        const userText = lastUserMsg?.content ?? '';

        if (!userText.trim()) {
          jsonResponse(res, { error: 'No user message found' }, 400, origin);
          return;
        }

        if (wsClient.connected) {
          console.log(`[bridge] Chat via WebSocket RPC (model=${model})`);

          if (model) {
            try { await wsClient.setModel(model); } catch (e) {
              console.warn(`[bridge] WS setModel failed: ${e.message}`);
            }
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...corsHeaders(origin),
          });

          const sseId = randomUUID();
          sseWrite(res, 'start', { id: sseId });

          const pushUnsubscribe = wsClient.onPush((msg) => {
            try {
              if (msg.type === 'push') {
                const push = msg.push ?? msg.data ?? msg;
                const pushType = push.type ?? push.kind;

                if (pushType === 'text' || pushType === 'text-delta' || pushType === 'delta') {
                  const delta = push.delta ?? push.text ?? push.content ?? '';
                  if (delta) {
                    sseWriteVercelAiFormat(res, '0', delta);
                  }
                } else if (pushType === 'toolcall' || pushType === 'tool-call' || pushType === 'tool_call') {
                  sseWriteVercelAiFormat(res, '9', {
                    args: push.args ?? push.arguments ?? push.input ?? {},
                    toolCallId: push.toolCallId ?? push.id ?? push.tool_call_id ?? randomUUID(),
                    toolName: push.toolName ?? push.name ?? push.tool_name ?? 'unknown',
                  });
                } else if (pushType === 'toolresult' || pushType === 'tool-result' || pushType === 'tool_result') {
                  sseWriteVercelAiFormat(res, 'a', {
                    result: push.result ?? push.output ?? null,
                    toolCallId: push.toolCallId ?? push.id ?? push.tool_call_id ?? '',
                  });
                } else if (pushType === 'done' || pushType === 'end' || pushType === 'complete') {
                  sseWrite(res, 'done', '[DONE]');
                  pushUnsubscribe();
                  res.end();
                } else if (pushType === 'error') {
                  const errMsg = push.error?.message ?? push.error ?? push.message ?? 'Unknown error';
                  sseWriteVercelAiFormat(res, '3', errMsg);
                  sseWrite(res, 'done', '[DONE]');
                  pushUnsubscribe();
                  res.end();
                }
              } else if (msg.type === 'session') {
                if (msg.event === 'chat.end' || msg.event === 'chat.done' || msg.event === 'done') {
                  sseWrite(res, 'done', '[DONE]');
                  pushUnsubscribe();
                  res.end();
                } else if (msg.event === 'chat.error' || msg.event === 'error') {
                  const errMsg = msg.error?.message ?? msg.message ?? 'Chat error';
                  sseWriteVercelAiFormat(res, '3', errMsg);
                  sseWrite(res, 'done', '[DONE]');
                  pushUnsubscribe();
                  res.end();
                }
              }
            } catch (e) {
              console.error('[bridge] SSE push handler error:', e.message);
            }
          });

          try {
            const result = await wsClient.sendMessage(userText);

            let responseText = '';
            if (typeof result === 'string') {
              responseText = result;
            } else if (result?.content) {
              responseText = typeof result.content === 'string' ? result.content : result.content.text ?? '';
            } else if (result?.text) {
              responseText = result.text;
            } else if (result?.message) {
              responseText = typeof result.message === 'string' ? result.message : result.message.content ?? '';
            }

            if (responseText) {
              sseWriteVercelAiFormat(res, '0', responseText);
            }

            setTimeout(() => {
              try {
                sseWrite(res, 'done', '[DONE]');
                pushUnsubscribe();
                if (!res.writableEnded) res.end();
              } catch {}
            }, 1000);
          } catch (rpcErr) {
            console.error(`[bridge] RPC error: ${rpcErr.message}`);

            sseWriteVercelAiFormat(res, '3', `OpenClaw RPC error: ${rpcErr.message}`);
            sseWrite(res, 'done', '[DONE]');
            pushUnsubscribe();
            if (!res.writableEnded) res.end();
          }

          req.on('close', () => {
            pushUnsubscribe();
          });

          return;
        }

        console.log(`[bridge] WS not connected — falling back to REST proxy (no agent tools)`);
        try {
          await proxyChatToModelhub(chatBody, req, res, origin);
        } catch (proxyErr) {
          console.error(`[bridge] REST proxy error: ${proxyErr.message}`);
          if (!res.headersSent) {
            jsonResponse(res, { error: BRIDGE_PROXY_FAILED_MESSAGE }, 502, origin);
          }
        }
        return;
      }

      jsonResponse(res, { error: 'Not found', paths: ['/api/status', '/api/config/model', '/v1/models', '/v1/chat/completions'] }, 404, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[bridge] Error: ${message}`);
      jsonResponse(res, { error: BRIDGE_REQUEST_FAILED_MESSAGE }, 502, origin);
    }
  });

  server.listen(bridgePort, '127.0.0.1', () => {
    console.log(`Bridge pronto em http://127.0.0.1:${bridgePort}`);
    console.log(`Aguardando conexoes do ModelHub web...`);
    console.log(`\nNo ModelHub, selecione "OpenClaw (bridge)" como provider para usar o gateway local.`);
    console.log(`Para parar: Ctrl+C\n`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Porta ${bridgePort} em uso. Use --port para outra porta.`);
      process.exitCode = 1;
    } else {
      console.error(`Erro no bridge: ${error.message}`);
      process.exitCode = 1;
    }
  });

  const cleanup = () => {
    wsClient.dispose();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
