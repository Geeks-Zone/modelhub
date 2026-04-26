import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildGatewayConnectParams } from './gateway-auth.mjs';

const RPC_TIMEOUT_MS = 30000;
const CONNECT_TIMEOUT_MS = 25000;
const HEARTBEAT_INTERVAL_MS = 20000;
const HEARTBEAT_MAX_MISSES = 2;
const RECONNECT_BASE_DELAY_MS = 3000;
const RECONNECT_MAX_DELAY_MS = 60000;
const SESSION_GET_TIMEOUT_MS = 2500;
const UNKNOWN_CLIENT_VERSION = ['0', '0', '0'].join('.');

/**
 * Le a versao do package.json em build-time. Antes era hardcoded como '2.0.14'
 * e dessincronizava da versao publicada toda vez que esquecia-se de atualizar.
 */
function readPackageVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(here, '..', 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    return typeof pkg?.version === 'string' && pkg.version ? pkg.version : UNKNOWN_CLIENT_VERSION;
  } catch {
    return UNKNOWN_CLIENT_VERSION;
  }
}

const CLIENT_VERSION = readPackageVersion();
const DEFAULT_CLIENT_ID = 'gateway-client';
const DEFAULT_CLIENT_MODE = 'backend';

function filterUndefinedEntries(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function normalizeError(error, fallback) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : fallback);
}

function extractSessionKey(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.sessionKey === 'string' && payload.sessionKey) {
    return payload.sessionKey;
  }
  if (payload.session && typeof payload.session === 'object' && typeof payload.session.sessionKey === 'string') {
    return payload.session.sessionKey;
  }
  if (payload.target && typeof payload.target === 'object' && typeof payload.target.sessionKey === 'string') {
    return payload.target.sessionKey;
  }
  if (typeof payload.key === 'string' && payload.key) {
    return payload.key;
  }
  return '';
}

function extractRunId(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  return String(
    payload.runId
      || payload.run?.id
      || payload.message?.runId
      || payload.data?.runId
      || '',
  );
}

function extractApprovalId(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  return String(
    payload.approvalId
      || payload.requestId
      || payload.approval?.id
      || '',
  );
}

function extractSessionRecord(payload) {
  if (!payload) {
    return null;
  }
  if (payload.session && typeof payload.session === 'object') {
    return payload.session;
  }
  if (typeof payload === 'object') {
    return payload;
  }
  return null;
}

function extractSessionResponse(payload) {
  const session = extractSessionRecord(payload);
  if (!session) {
    return null;
  }
  const sessionKey = extractSessionKey(session);
  return {
    agentId: session.agentId || session.agent?.id || null,
    id: String(session.id || session.sessionId || sessionKey || ''),
    label: String(session.label || session.title || session.name || ''),
    sessionKey,
  };
}

function buildMessagePayload(message) {
  if (typeof message === 'string') {
    return message;
  }

  if (message && typeof message === 'object' && typeof message.content === 'string') {
    return message.content;
  }

  return '';
}

function normalizeSessionModelSelection(model) {
  if (typeof model === 'string') {
    return model;
  }

  if (model && typeof model === 'object' && typeof model.primary === 'string') {
    return model.primary;
  }

  return undefined;
}

function normalizeSessionPatch(patch) {
  const nextPatch = { ...(patch && typeof patch === 'object' ? patch : {}) };
  if ('model' in nextPatch) {
    nextPatch.model = normalizeSessionModelSelection(nextPatch.model);
  }
  return filterUndefinedEntries(nextPatch);
}

export class GatewayClient {
  #connected = false;
  #connectPromise = null;
  #disposed = false;
  #eventHandlers = new Set();
  #heartbeatMisses = 0;
  #heartbeatTimer = null;
  #hello = null;
  #lastError = null;
  #log;
  #reconnectAttempt = 0;
  #reconnectTimer = null;
  #reconnecting = false;
  #requestMap = new Map();
  #sessionHandlers = new Map();
  #token;
  #url;
  #ws = null;

  constructor(gatewayUrl, token, log) {
    this.#url = gatewayUrl.replace(/^http/i, 'ws');
    this.#token = token;
    this.#log = log;
  }

  get connected() {
    return this.#connected;
  }

  get hello() {
    return this.#hello;
  }

  get status() {
    return {
      connected: this.#connected,
      lastError: this.#lastError,
      reconnectAttempt: this.#reconnectAttempt,
      reconnecting: this.#reconnecting || Boolean(this.#reconnectTimer),
    };
  }

  async connect() {
    if (this.#connected && this.#ws?.readyState === 1) {
      return;
    }
    if (this.#connectPromise) {
      return this.#connectPromise;
    }

    this.#connectPromise = this.#doConnect();
    try {
      await this.#connectPromise;
    } finally {
      this.#connectPromise = null;
    }
  }

  async #doConnect() {
    const mod = await import('ws');
    const WebSocketClass = mod.WebSocket || mod.default || mod;

    return new Promise((resolve, reject) => {
      const ws = new WebSocketClass(this.#url);
      this.#ws = ws;
      let challengeNonce = null;
      let connectSent = false;
      let settled = false;
      const connectTimeout = setTimeout(() => {
        if (!settled) {
          const timeoutError = new Error('Connection timeout');
          this.#lastError = timeoutError.message;
          settleReject(timeoutError);
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
      }, CONNECT_TIMEOUT_MS);
      connectTimeout.unref?.();

      const settleReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimeout);
        const normalized = normalizeError(error, 'Gateway connect failed');
        this.#lastError = normalized.message;
        reject(normalized);
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimeout);
        resolve();
      };

      const sendConnect = () => {
        if (connectSent || ws.readyState !== 1 || !challengeNonce) {
          return;
        }
        connectSent = true;
        const connectId = `connect:${randomUUID()}`;
        const params = buildGatewayConnectParams({
          challengeNonce,
          clientDisplayName: 'ModelHub Bridge',
          clientId: DEFAULT_CLIENT_ID,
          clientMode: DEFAULT_CLIENT_MODE,
          token: this.#token,
          version: CLIENT_VERSION,
        });
        ws.send(JSON.stringify({ id: connectId, method: 'connect', params, type: 'req' }));
      };

      ws.addEventListener('open', () => {});

      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
        } catch {
          return;
        }

        if (msg?.type === 'event' && msg?.event === 'connect.challenge') {
          challengeNonce = msg?.payload?.nonce ?? null;
          sendConnect();
          return;
        }

        this.#handleMessage(msg);

        if (msg?.type === 'res' && msg?.ok === true && msg?.payload?.type === 'hello-ok') {
          this.#connected = true;
          this.#hello = msg.payload;
          this.#lastError = null;
          this.#reconnectAttempt = 0;
          this.#reconnecting = false;
          this.#startHeartbeat(ws);
          this.#log.info('[gw] Connected to gateway');
          settleResolve();
          return;
        }

        if (msg?.type === 'res' && String(msg?.id || '').startsWith('connect:') && msg?.ok === false) {
          settleReject(msg?.error?.message || msg?.error?.details?.reason || 'Connection rejected');
        }
      });

      ws.on?.('pong', () => {
        this.#heartbeatMisses = 0;
      });

      ws.addEventListener('close', (event) => {
        const error = new Error(`WS closed: ${event.code}`);
        this.#connected = false;
        this.#lastError = error.message;
        this.#stopHeartbeat(ws);
        if (this.#ws === ws) {
          this.#ws = null;
        }
        this.#hello = null;
        for (const [, entry] of this.#requestMap) {
          entry.reject(error);
        }
        this.#requestMap.clear();
        this.#log.debug(`[gw] Disconnected (code=${event.code})`);
        if (!settled) {
          settleReject(error);
        }
        if (!this.#disposed) {
          this.#scheduleReconnect();
        }
      });

      ws.addEventListener('error', (event) => {
        const message = event?.message || 'WS error';
        this.#lastError = message;
        if (!settled) {
          settleReject(new Error(message));
        } else {
          this.#log.warn('[gw] Error:', message);
        }
      });
    });
  }

  #scheduleReconnect() {
    if (this.#reconnectTimer || this.#disposed) {
      return;
    }
    this.#reconnecting = true;
    const attempt = this.#reconnectAttempt;
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
    );
    this.#reconnectAttempt = attempt + 1;
    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      try {
        await this.connect();
        for (const sessionKey of this.#sessionHandlers.keys()) {
          try {
            await this.request('sessions.messages.subscribe', { key: sessionKey });
          } catch (error) {
            this.#log.warn(`[gw] Failed to restore session subscription ${sessionKey}:`, normalizeError(error, 'subscribe').message);
          }
        }
      } catch (error) {
        const normalized = normalizeError(error, 'reconnect');
        this.#lastError = normalized.message;
        this.#log.warn('[gw] Reconnect failed:', normalized.message);
        this.#scheduleReconnect();
      }
    }, delay);
  }

  #startHeartbeat(ws) {
    this.#stopHeartbeat(ws);
    this.#heartbeatMisses = 0;
    this.#heartbeatTimer = setInterval(() => {
      if (this.#ws !== ws || ws.readyState !== 1) {
        return;
      }

      if (this.#heartbeatMisses >= HEARTBEAT_MAX_MISSES) {
        this.#lastError = 'Gateway heartbeat missed';
        if (typeof ws.terminate === 'function') {
          ws.terminate();
        } else {
          ws.close();
        }
        return;
      }

      this.#heartbeatMisses += 1;
      try {
        ws.ping();
      } catch (error) {
        this.#lastError = normalizeError(error, 'Gateway heartbeat failed').message;
        if (typeof ws.terminate === 'function') {
          ws.terminate();
        } else {
          ws.close();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.#heartbeatTimer.unref?.();
  }

  #stopHeartbeat(ws) {
    if (ws && this.#ws !== ws) {
      return;
    }
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    this.#heartbeatMisses = 0;
  }

  #handleMessage(msg) {
    if (msg?.type === 'res' && msg?.id) {
      const entry = this.#requestMap.get(msg.id);
      if (entry) {
        this.#requestMap.delete(msg.id);
        if (msg.ok === false) {
          entry.reject(new Error(msg?.error?.message || msg?.error?.details?.reason || JSON.stringify(msg.error)));
        } else {
          entry.resolve(msg.payload);
        }
      }
      return;
    }

    if (msg?.type !== 'event') {
      return;
    }

    for (const handler of this.#eventHandlers) {
      try {
        handler(msg);
      } catch (error) {
        this.#log.warn('[gw] event handler error:', normalizeError(error, 'event handler').message);
      }
    }

    const sessionKey = extractSessionKey(msg.payload);
    if (!sessionKey) {
      return;
    }

    const handlers = this.#sessionHandlers.get(sessionKey);
    if (!handlers?.size) {
      return;
    }

    for (const handler of handlers) {
      try {
        handler(msg);
      } catch (error) {
        this.#log.warn('[gw] session handler error:', normalizeError(error, 'session handler').message);
      }
    }
  }

  async request(method, params = {}, options = {}) {
    await this.connect();
    const id = randomUUID();
    const timeoutMs = options.timeout ?? RPC_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.#requestMap.delete(id);
            reject(new Error(`RPC timeout: ${method}`));
          }, timeoutMs)
        : null;

      this.#requestMap.set(id, {
        reject: (error) => {
          if (timer) {
            clearTimeout(timer);
          }
          reject(error);
        },
        resolve: (value) => {
          if (timer) {
            clearTimeout(timer);
          }
          resolve(value);
        },
      });

      // Entre await connect() e send, o close handler pode ter zerado #ws.
      // Sem essa defesa, send() em null gera TypeError nao tratavel pelo caller.
      const ws = this.#ws;
      if (ws?.readyState !== 1) {
        this.#requestMap.delete(id);
        if (timer) {
          clearTimeout(timer);
        }
        reject(new Error(`Gateway WS not ready for ${method}`));
        return;
      }

      try {
        ws.send(JSON.stringify({
          id,
          method,
          params,
          type: 'req',
        }));
      } catch (error) {
        this.#requestMap.delete(id);
        if (timer) {
          clearTimeout(timer);
        }
        reject(normalizeError(error, `Gateway send failed: ${method}`));
      }
    });
  }

  onEvent(handler) {
    this.#eventHandlers.add(handler);
    return () => this.#eventHandlers.delete(handler);
  }

  async modelsList() {
    const payload = await this.request('models.list');
    return Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.data)
          ? payload.data
          : [];
  }

  async sessionsList() {
    const payload = await this.request('sessions.list');
    return Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.sessions)
        ? payload.sessions
        : [];
  }

  async sessionGet(sessionKey, options = {}) {
    if (!sessionKey) {
      return null;
    }
    try {
      const payload = await this.request('sessions.get', { key: sessionKey }, {
        timeout: options.timeout ?? SESSION_GET_TIMEOUT_MS,
      });
      return extractSessionResponse(payload);
    } catch {
      return null;
    }
  }

  async sessionCreate(options = {}) {
    const params = filterUndefinedEntries({
      key: options.sessionKey,
      label: options.label,
      model: normalizeSessionModelSelection(options.model),
    });

    const payload = await this.request('sessions.create', params);
    const session = extractSessionResponse(payload);
    if (!session?.sessionKey) {
      throw new Error('Gateway did not return a sessionKey');
    }
    return session;
  }

  async sessionSend(sessionKey, message, options = {}) {
    const idempotencyKey = options.idempotencyKey || randomUUID();
    const normalizedMessage = buildMessagePayload(message);

    const attempts = [
      { method: 'chat.send', params: { idempotencyKey, message: normalizedMessage, sessionKey } },
      { method: 'sessions.send', params: { idempotencyKey, key: sessionKey, message: normalizedMessage } },
    ];

    let lastError = null;
    for (const attempt of attempts) {
      try {
        return await this.request(attempt.method, attempt.params, { timeout: null });
      } catch (error) {
        lastError = error;
      }
    }

    throw normalizeError(lastError, 'Gateway send failed');
  }

  async sessionPatch(sessionKey, patch) {
    return this.request('sessions.patch', {
      key: sessionKey,
      ...normalizeSessionPatch(patch),
    });
  }

  async sessionAbort(sessionKey, runId) {
    try {
      return await this.request('chat.abort', filterUndefinedEntries({ runId, sessionKey }));
    } catch {
      return this.request('sessions.abort', filterUndefinedEntries({ key: sessionKey, runId }));
    }
  }

  async approvalResolve(approvalId, approved, reason) {
    const params = {
      decision: approved === false ? 'deny' : 'allow-once',
      id: approvalId,
    };
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (trimmedReason) {
      params.reason = trimmedReason;
    }
    return this.request('exec.approval.resolve', params);
  }

  async subscribeSession(sessionKey, handler) {
    if (!sessionKey) {
      throw new Error('sessionKey is required');
    }

    let handlers = this.#sessionHandlers.get(sessionKey);
    const isFirstSubscriber = !handlers;
    if (isFirstSubscriber) {
      handlers = new Set();
      this.#sessionHandlers.set(sessionKey, handlers);
      try {
        await this.request('sessions.messages.subscribe', { key: sessionKey });
      } catch (error) {
        // Reverte para evitar estado fantasma: sem o subscribe RPC, o
        // gateway nao envia eventos e o Map continuaria com o set vazio,
        // fazendo a proxima chamada pular o subscribe definitivamente.
        this.#sessionHandlers.delete(sessionKey);
        throw error;
      }
    }

    handlers.add(handler);

    return async () => {
      await this.unsubscribeSession(sessionKey, handler);
    };
  }

  async unsubscribeSession(sessionKey, handler) {
    const handlers = this.#sessionHandlers.get(sessionKey);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);
    if (handlers.size > 0) {
      return;
    }

    this.#sessionHandlers.delete(sessionKey);
    try {
      await this.request('sessions.messages.unsubscribe', { key: sessionKey });
    } catch (error) {
      this.#log.debug(`[gw] unsubscribe failed for ${sessionKey}:`, normalizeError(error, 'unsubscribe').message);
    }
  }

  dispose() {
    this.#disposed = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#stopHeartbeat(this.#ws);
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
    this.#connected = false;
    this.#hello = null;
    this.#reconnecting = false;
    this.#sessionHandlers.clear();
  }
}

export {
  extractApprovalId,
  extractRunId,
  extractSessionKey,
};
