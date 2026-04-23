import { randomUUID } from 'node:crypto';

const RPC_TIMEOUT_MS = 30000;
const CONNECT_TIMEOUT_MS = 10000;
const RECONNECT_DELAY_MS = 3000;

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
  return typeof message === 'string'
    ? message
    : filterUndefinedEntries({
        content: message.content,
        role: message.role || 'user',
      });
}

export class GatewayClient {
  #connected = false;
  #connectPromise = null;
  #disposed = false;
  #eventHandlers = new Set();
  #hello = null;
  #log;
  #reconnectTimer = null;
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
    let WebSocketClass = globalThis.WebSocket;
    if (!WebSocketClass) {
      const mod = await import('ws');
      WebSocketClass = mod.WebSocket || mod.default || mod;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocketClass(this.#url);
      this.#ws = ws;
      let challengeNonce = null;
      let connectSent = false;
      let settled = false;

      const settleReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(normalizeError(error, 'Gateway connect failed'));
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      const sendConnect = () => {
        if (connectSent || ws.readyState !== 1) {
          return;
        }
        connectSent = true;
        const connectId = `connect:${randomUUID()}`;
        const params = filterUndefinedEntries({
          auth: this.#token ? { token: this.#token } : undefined,
          caps: [],
          client: {
            displayName: 'ModelHub Bridge',
            id: 'modelhub-bridge',
            mode: 'operator',
            platform: process.platform,
            version: '2.0.0',
          },
          commands: [],
          device: challengeNonce
            ? {
                id: `modelhub-bridge-${process.pid}`,
                nonce: challengeNonce,
                signedAt: Date.now(),
              }
            : undefined,
          locale: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
          maxProtocol: 3,
          minProtocol: 3,
          permissions: {},
          role: 'operator',
          scopes: ['operator.approvals', 'operator.read', 'operator.write'],
          userAgent: 'modelhub-bridge/2.0.0',
        });
        ws.send(JSON.stringify({ id: connectId, method: 'connect', params, type: 'req' }));
      };

      ws.addEventListener('open', () => {
        setTimeout(sendConnect, 50);
      });

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
          this.#log.info('[gw] Connected to gateway');
          settleResolve();
          return;
        }

        if (msg?.type === 'res' && String(msg?.id || '').startsWith('connect:') && msg?.ok === false) {
          settleReject(msg?.error?.message || msg?.error?.details?.reason || 'Connection rejected');
        }
      });

      ws.addEventListener('close', (event) => {
        const error = new Error(`WS closed: ${event.code}`);
        this.#connected = false;
        this.#ws = null;
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
        if (!settled) {
          settleReject(new Error(message));
        } else {
          this.#log.warn('[gw] Error:', message);
        }
      });

      setTimeout(() => {
        if (!settled) {
          settleReject(new Error('Connection timeout'));
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
      }, CONNECT_TIMEOUT_MS);
    });
  }

  #scheduleReconnect() {
    if (this.#reconnectTimer || this.#disposed) {
      return;
    }
    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      try {
        await this.connect();
        for (const sessionKey of this.#sessionHandlers.keys()) {
          try {
            await this.request('sessions.messages.subscribe', { sessionKey });
          } catch (error) {
            this.#log.warn(`[gw] Failed to restore session subscription ${sessionKey}:`, normalizeError(error, 'subscribe').message);
          }
        }
      } catch (error) {
        this.#log.warn('[gw] Reconnect failed:', normalizeError(error, 'reconnect').message);
      }
    }, RECONNECT_DELAY_MS);
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

      this.#ws.send(JSON.stringify({
        id,
        method,
        params,
        type: 'req',
      }));
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

  async sessionGet(sessionKey) {
    if (!sessionKey) {
      return null;
    }
    try {
      const payload = await this.request('sessions.get', { sessionKey });
      return extractSessionResponse(payload);
    } catch {
      return null;
    }
  }

  async sessionCreate(options = {}) {
    const params = filterUndefinedEntries({
      label: options.label,
      metadata: options.metadata,
      model: options.model,
      sessionKey: options.sessionKey,
      title: options.label,
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
    const payloadVariants = [
      { sessionKey, idempotencyKey, message: buildMessagePayload(message) },
      { sessionKey, idempotencyKey, content: typeof message === 'string' ? message : message.content },
    ];

    const attempts = [
      { method: 'sessions.send', params: payloadVariants[0] },
      { method: 'sessions.send', params: payloadVariants[1] },
      { method: 'chat.send', params: payloadVariants[0] },
      { method: 'chat.send', params: payloadVariants[1] },
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
    return this.request('sessions.patch', filterUndefinedEntries({
      sessionKey,
      ...patch,
    }));
  }

  async sessionAbort(sessionKey, runId) {
    try {
      return await this.request('sessions.abort', filterUndefinedEntries({ runId, sessionKey }));
    } catch {
      return this.request('chat.abort', filterUndefinedEntries({ runId, sessionKey }));
    }
  }

  async approvalResolve(approvalId, approved, reason) {
    return this.request('exec.approval.resolve', filterUndefinedEntries({
      approvalId,
      approved,
      reason,
    }));
  }

  async subscribeSession(sessionKey, handler) {
    if (!sessionKey) {
      throw new Error('sessionKey is required');
    }

    let handlers = this.#sessionHandlers.get(sessionKey);
    if (!handlers) {
      handlers = new Set();
      this.#sessionHandlers.set(sessionKey, handlers);
      await this.request('sessions.messages.subscribe', { sessionKey });
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
      await this.request('sessions.messages.unsubscribe', { sessionKey });
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
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
    this.#connected = false;
    this.#hello = null;
    this.#sessionHandlers.clear();
  }
}

export {
  extractApprovalId,
  extractRunId,
  extractSessionKey,
};
