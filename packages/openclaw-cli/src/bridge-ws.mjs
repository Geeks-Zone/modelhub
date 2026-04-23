import { randomUUID } from 'node:crypto';

import {
  extractApprovalId,
  extractRunId,
  extractSessionKey,
} from './gateway-client.mjs';

const ALLOWED_ORIGINS = new Set([
  'https://www.modelhub.com.br',
  'https://modelhub.com.br',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
const NOOP_EVENT_HANDLER = () => {};

function getAllowedOrigins() {
  const extra = (process.env.MODELHUB_BRIDGE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...ALLOWED_ORIGINS, ...extra]);
}

function isOriginAllowed(origin) {
  if (!origin) {
    return false;
  }
  const allowed = getAllowedOrigins();
  if (allowed.has(origin)) {
    return true;
  }
  try {
    const url = new URL(origin);
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.protocol === 'http:';
  } catch {
    return false;
  }
}

function getModelsFromConfig(config) {
  const providers = config?.models?.providers;
  if (!providers || typeof providers !== 'object') {
    return [];
  }

  const models = [];
  for (const provider of Object.values(providers)) {
    if (!Array.isArray(provider?.models)) {
      continue;
    }
    for (const model of provider.models) {
      if (!model?.id) {
        continue;
      }
      models.push({
        id: model.id,
        name: model.name || model.alias || model.id,
      });
    }
  }
  return models;
}

function extractTextPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.delta === 'string' && payload.delta) {
    return payload.delta;
  }
  if (typeof payload.text === 'string' && payload.text) {
    return payload.text;
  }
  if (typeof payload.content === 'string' && payload.content) {
    return payload.content;
  }
  if (payload.message && typeof payload.message === 'object') {
    if (typeof payload.message.delta === 'string' && payload.message.delta) {
      return payload.message.delta;
    }
    if (typeof payload.message.text === 'string' && payload.message.text) {
      return payload.message.text;
    }
    if (typeof payload.message.content === 'string' && payload.message.content) {
      return payload.message.content;
    }
  }
  return '';
}

function extractToolStartPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const toolCallId = String(payload.toolCallId || payload.id || payload.callId || '');
  const toolName = String(payload.toolName || payload.name || payload.tool || '');
  const args = payload.args || payload.arguments || payload.input || {};
  if (!toolCallId && !toolName) {
    return null;
  }
  return {
    args,
    toolCallId: toolCallId || randomUUID(),
    toolName: toolName || 'tool',
  };
}

function extractToolResultPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const toolCallId = String(payload.toolCallId || payload.id || payload.callId || '');
  if (!toolCallId) {
    return null;
  }
  return {
    result: payload.result ?? payload.output ?? payload.data ?? null,
    toolCallId,
  };
}

function isFinalPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const marker = String(payload.phase || payload.state || payload.status || payload.kind || payload.type || '').toLowerCase();
  return ['complete', 'completed', 'done', 'end', 'final', 'finished', 'ok'].includes(marker);
}

function isErrorPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const marker = String(payload.phase || payload.state || payload.status || payload.kind || payload.type || '').toLowerCase();
  return marker === 'error' || Boolean(payload.error);
}

export class BridgeWSServer {
  #clientStates = new Map();
  #config;
  #gatewayClient;
  #globalGatewayUnsubscribe = null;
  #log;
  #wss = null;

  constructor(gatewayClient, config, log) {
    this.#gatewayClient = gatewayClient;
    this.#config = config;
    this.#log = log;
    this.#globalGatewayUnsubscribe = this.#gatewayClient.onEvent((event) => {
      this.#handleGatewayEvent(event);
    });
  }

  async attach(httpServer) {
    const mod = await import('ws');
    const WebSocketServer = mod.WebSocketServer || mod.Server || mod.default || mod;

    this.#wss = new WebSocketServer({ path: '/ws', server: httpServer });
    this.#log.info('[ws] Browser WS endpoint at /ws');

    this.#wss.on('connection', (ws, req) => {
      const origin = req.headers.origin || '';
      if (!isOriginAllowed(origin)) {
        this.#log.warn(`[ws] Rejected origin: ${origin}`);
        ws.close(4403, 'Origin not allowed');
        return;
      }

      const clientId = randomUUID();
      this.#clientStates.set(clientId, {
        activeRequestId: '',
        activeRunId: '',
        conversationId: '',
        sessionKey: '',
        subscriptionStop: null,
        ws,
      });

      this.#send(ws, {
        bridgeId: this.#config.bridgeId,
        gateway: { ok: this.#gatewayClient.connected, ws: this.#gatewayClient.connected },
        model: { primary: this.#config.getPrimaryModel() },
        models: getModelsFromConfig(this.#config.getConfig()),
        type: 'hello',
      });

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
        } catch {
          return;
        }
        void this.#handleBrowserMessage(clientId, msg);
      });

      ws.on('close', () => {
        void this.#cleanupClient(clientId);
      });
    });
  }

  async #handleBrowserMessage(clientId, msg) {
    const state = this.#clientStates.get(clientId);
    if (!state) {
      return;
    }

    try {
      switch (msg.type) {
        case 'ready':
          this.#send(state.ws, { requestId: msg.requestId, type: 'ready' });
          return;

        case 'ping':
          this.#send(state.ws, { requestId: msg.requestId, type: 'pong' });
          return;

        case 'session.ensure':
          await this.#handleSessionEnsure(state, msg);
          return;

        case 'chat.send':
          await this.#handleChatSend(state, msg);
          return;

        case 'chat.abort':
          await this.#handleChatAbort(state, msg);
          return;

        case 'model.list':
          this.#send(state.ws, {
            models: getModelsFromConfig(this.#config.getConfig()),
            requestId: msg.requestId,
            type: 'model.list',
          });
          return;

        case 'model.change':
          await this.#handleModelChange(state, msg);
          return;

        case 'tool.approval.resolve':
          await this.#handleToolApproval(state, msg);
          return;

        default:
          this.#log.debug(`[ws] Unknown browser message type: ${msg.type}`);
      }
    } catch (error) {
      this.#send(state.ws, {
        error: error instanceof Error ? error.message : String(error),
        requestId: msg.requestId,
        runId: state.activeRunId || undefined,
        type: 'run.error',
      });
    }
  }

  async #handleSessionEnsure(state, msg) {
    const conversationId = String(msg.conversationId || state.conversationId || randomUUID());
    const requestedSessionKey = String(msg.sessionKey || state.sessionKey || `modelhub:${conversationId}`);
    const modelRef = msg.model || this.#config.getPrimaryModel() || undefined;

    let session = await this.#gatewayClient.sessionGet(requestedSessionKey);
    if (!session) {
      session = await this.#gatewayClient.sessionCreate({
        label: conversationId,
        model: modelRef ? { primary: modelRef } : undefined,
        sessionKey: requestedSessionKey,
      });
    }

    if (state.subscriptionStop && state.sessionKey && state.sessionKey !== session.sessionKey) {
      await state.subscriptionStop();
      state.subscriptionStop = null;
    }

    if (!state.subscriptionStop || state.sessionKey !== session.sessionKey) {
      state.subscriptionStop = await this.#gatewayClient.subscribeSession(session.sessionKey, NOOP_EVENT_HANDLER);
    }

    state.conversationId = conversationId;
    state.sessionKey = session.sessionKey;

    this.#send(state.ws, {
      conversationId,
      requestId: msg.requestId,
      sessionKey: session.sessionKey,
      type: 'session.ready',
    });
  }

  async #handleChatSend(state, msg) {
    await this.#handleSessionEnsure(state, {
      conversationId: msg.conversationId,
      model: msg.model,
      requestId: msg.requestId,
      sessionKey: msg.sessionKey,
    });

    if (msg.model) {
      await this.#gatewayClient.sessionPatch(state.sessionKey, {
        model: { primary: msg.model },
      });
    }

    state.activeRequestId = String(msg.requestId || randomUUID());
    state.activeRunId = '';

    const result = await this.#gatewayClient.sessionSend(
      state.sessionKey,
      String(msg.content || msg.text || ''),
      { idempotencyKey: state.activeRequestId },
    );

    const runId = extractRunId(result);
    if (runId) {
      state.activeRunId = runId;
    }

    const immediateText = extractTextPayload(result);
    if (immediateText) {
      this.#send(state.ws, {
        delta: immediateText,
        requestId: state.activeRequestId,
        runId: state.activeRunId || undefined,
        type: 'chat.delta',
      });
      this.#send(state.ws, {
        requestId: state.activeRequestId,
        runId: state.activeRunId || undefined,
        type: 'run.completed',
      });
    }
  }

  async #handleChatAbort(state, msg) {
    if (!state.sessionKey) {
      return;
    }

    await this.#gatewayClient.sessionAbort(state.sessionKey, state.activeRunId || undefined);
    this.#send(state.ws, {
      requestId: msg.requestId,
      runId: state.activeRunId || undefined,
      type: 'chat.aborted',
    });
    state.activeRunId = '';
  }

  async #handleModelChange(state, msg) {
    const modelRef = String(msg.model || msg.primary || '');
    if (!modelRef) {
      throw new Error('Missing model');
    }

    await this.#config.changeModel(modelRef);
    if (state.sessionKey) {
      await this.#gatewayClient.sessionPatch(state.sessionKey, {
        model: { primary: modelRef },
      });
    }

    this.#send(state.ws, {
      model: modelRef,
      requestId: msg.requestId,
      type: 'model.changed',
    });
  }

  async #handleToolApproval(state, msg) {
    if (!msg.approvalId) {
      throw new Error('Missing approvalId');
    }

    await this.#gatewayClient.approvalResolve(msg.approvalId, msg.approved !== false, msg.reason);
    this.#send(state.ws, {
      approvalId: msg.approvalId,
      requestId: msg.requestId,
      runId: state.activeRunId || undefined,
      type: 'tool.approval.resolved',
    });
  }

  #handleGatewayEvent(event) {
    const sessionKey = extractSessionKey(event.payload);
    const approvalId = extractApprovalId(event.payload);

    for (const state of this.#clientStates.values()) {
      if (sessionKey && state.sessionKey && sessionKey !== state.sessionKey) {
        continue;
      }

      if (event.event === 'session.message') {
        this.#forwardSessionMessage(state, event.payload);
      } else if (event.event === 'session.tool') {
        this.#forwardSessionTool(state, event.payload);
      } else if (event.event === 'exec.approval.requested' && approvalId) {
        this.#send(state.ws, {
          approvalId,
          args: event.payload?.systemRunPlan || {
            argv: event.payload?.argv,
            command: event.payload?.command,
            cwd: event.payload?.cwd,
            rawCommand: event.payload?.rawCommand,
          },
          requestId: state.activeRequestId || undefined,
          runId: extractRunId(event.payload) || state.activeRunId || undefined,
          toolCallId: approvalId,
          toolName: 'system.run',
          type: 'tool.approval.requested',
        });
      } else if (event.event === 'exec.approval.resolved' && approvalId) {
        this.#send(state.ws, {
          approvalId,
          requestId: state.activeRequestId || undefined,
          runId: extractRunId(event.payload) || state.activeRunId || undefined,
          type: 'tool.approval.resolved',
        });
      }
    }
  }

  #forwardSessionMessage(state, payload) {
    const runId = extractRunId(payload) || state.activeRunId || undefined;
    if (runId) {
      state.activeRunId = runId;
    }

    const text = extractTextPayload(payload);
    if (text) {
      this.#send(state.ws, {
        delta: text,
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'chat.delta',
      });
    }

    if (isErrorPayload(payload)) {
      this.#send(state.ws, {
        error: payload?.error?.message || payload?.error || 'Session error',
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'run.error',
      });
      return;
    }

    if (isFinalPayload(payload)) {
      this.#send(state.ws, {
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'run.completed',
      });
    }
  }

  #forwardSessionTool(state, payload) {
    const runId = extractRunId(payload) || state.activeRunId || undefined;
    if (runId) {
      state.activeRunId = runId;
    }

    const approvalId = extractApprovalId(payload);
    if (approvalId) {
      this.#send(state.ws, {
        approvalId,
        args: payload?.systemRunPlan || payload?.args || payload?.arguments || {},
        requestId: state.activeRequestId || undefined,
        runId,
        toolCallId: approvalId,
        toolName: payload?.toolName || payload?.name || 'system.run',
        type: 'tool.approval.requested',
      });
      return;
    }

    const toolStart = extractToolStartPayload(payload);
    if (toolStart) {
      this.#send(state.ws, {
        ...toolStart,
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'tool.update',
      });
    }

    const toolResult = extractToolResultPayload(payload);
    if (toolResult) {
      this.#send(state.ws, {
        ...toolResult,
        requestId: state.activeRequestId || undefined,
        runId,
        status: 'completed',
        type: 'tool.update',
      });
    }

    if (isFinalPayload(payload)) {
      this.#send(state.ws, {
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'run.completed',
      });
    }
  }

  async #cleanupClient(clientId) {
    const state = this.#clientStates.get(clientId);
    if (!state) {
      return;
    }
    this.#clientStates.delete(clientId);
    if (state.subscriptionStop) {
      await state.subscriptionStop();
    }
  }

  #send(ws, payload) {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
      }
    } catch {
      // ignore disconnected browser
    }
  }

  async patchAllKnownSessions(modelRef) {
    const tasks = [];
    for (const state of this.#clientStates.values()) {
      if (!state.sessionKey) {
        continue;
      }
      tasks.push(
        this.#gatewayClient.sessionPatch(state.sessionKey, {
          model: { primary: modelRef },
        }).catch(() => {}),
      );
    }
    await Promise.all(tasks);
  }

  async close() {
    if (this.#globalGatewayUnsubscribe) {
      this.#globalGatewayUnsubscribe();
      this.#globalGatewayUnsubscribe = null;
    }

    const cleanupTasks = [];
    for (const clientId of this.#clientStates.keys()) {
      cleanupTasks.push(this.#cleanupClient(clientId));
    }
    await Promise.all(cleanupTasks);

    if (this.#wss) {
      for (const client of this.#wss.clients) {
        client.close(1001, 'Bridge shutting down');
      }
      this.#wss.close();
      this.#wss = null;
    }
  }
}
