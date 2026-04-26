import { randomUUID } from 'node:crypto';

import {
  extractApprovalId,
  extractRunId,
  extractSessionKey,
} from './gateway-client.mjs';
import {
  normalizeConfiguredModelRef,
} from './utils.mjs';
import { ensureModelHubPrefix, isOriginAllowed } from './bridge-shared.mjs';
import { parseBridgeEventPayload } from './bridge-events-schema.mjs';

const NOOP_EVENT_HANDLER = () => {};
const BROWSER_WS_HEARTBEAT_INTERVAL_MS = 20000;
const BROWSER_WS_HEARTBEAT_MAX_MISSES = 2;

const normalizeModelRef = ensureModelHubPrefix;

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
  if (Array.isArray(payload.content)) {
    const text = payload.content
      .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('');
    if (text) {
      return text;
    }
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
    if (Array.isArray(payload.message.content)) {
      const text = payload.message.content
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('');
      if (text) {
        return text;
      }
    }
  }
  return '';
}

function getMessagePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return payload.message && typeof payload.message === 'object'
    ? payload.message
    : payload;
}

function extractMessageRole(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.role === 'string' && payload.role) {
    return payload.role;
  }
  if (payload.message && typeof payload.message === 'object' && typeof payload.message.role === 'string') {
    return payload.message.role;
  }
  return '';
}

function extractMessageContentParts(payload) {
  const message = getMessagePayload(payload);
  if (!message || typeof message !== 'object') {
    return [];
  }
  return Array.isArray(message.content) ? message.content : [];
}

function extractToolCallPayloads(payload) {
  const parts = extractMessageContentParts(payload);
  const toolCalls = [];
  for (const part of parts) {
    const type = String(part?.type || '').toLowerCase();
    if (type !== 'toolcall' && type !== 'tool-call' && type !== 'tool_call') {
      continue;
    }

    const toolName = String(part.name || part.toolName || part.tool || '');
    toolCalls.push({
      args: part.arguments ?? part.args ?? part.input ?? {},
      toolCallId: String(part.id || part.toolCallId || part.callId || randomUUID()),
      toolName: toolName || 'tool',
    });
  }
  return toolCalls;
}

function extractToolResultMessagePayload(payload) {
  const message = getMessagePayload(payload);
  if (!message || typeof message !== 'object') {
    return null;
  }

  const role = extractMessageRole(payload).toLowerCase();
  if (role !== 'toolresult' && role !== 'tool_result' && role !== 'tool') {
    return null;
  }

  const toolCallId = String(message.toolCallId || message.id || message.callId || payload.toolCallId || '');
  if (!toolCallId) {
    return null;
  }

  const parts = Array.isArray(message.content) ? message.content : [];
  const text = parts
    .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');

  return {
    result: message.details ?? (text || message.result || message.output || null),
    status: message.details?.status || message.status || payload.status || 'completed',
    toolCallId,
    toolName: String(message.toolName || payload.toolName || 'tool'),
  };
}

function extractErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.error === 'string' && payload.error) {
    return payload.error;
  }
  if (payload.error && typeof payload.error === 'object') {
    if (typeof payload.error.message === 'string' && payload.error.message) {
      return payload.error.message;
    }
    if (typeof payload.error.details?.reason === 'string' && payload.error.details.reason) {
      return payload.error.details.reason;
    }
  }
  if (payload.message && typeof payload.message === 'object' && typeof payload.message.errorMessage === 'string') {
    return payload.message.errorMessage;
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

function extractGatewayToolFailure(line) {
  const text = String(line || '').trim();
  if (!text.includes('[tools]') || !/\bfailed\b/i.test(text)) {
    return null;
  }

  const toolsIndex = text.indexOf('[tools]');
  const rawParamsIndex = text.indexOf(' raw_params=');
  const messageStart = toolsIndex >= 0 ? toolsIndex + '[tools]'.length : 0;
  const messageEnd = rawParamsIndex >= 0 ? rawParamsIndex : text.length;
  const message = text.slice(messageStart, messageEnd).trim() || text;
  let args = null;

  if (rawParamsIndex >= 0) {
    const rawParams = text.slice(rawParamsIndex + ' raw_params='.length).trim();
    try {
      args = JSON.parse(rawParams);
    } catch {
      args = rawParams;
    }
  }

  return { args, message };
}

function isModelHubApiKeyError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('invalid or revoked api key')
    || normalized.includes('api key do modelhub')
    || normalized.includes('no api key found for provider "modelhub"')
    || normalized.includes('no api key found for provider \'modelhub\'');
}

function isFinalPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const stopReason = String(payload?.message?.stopReason || payload.stopReason || '').toLowerCase();
  if (['tooluse', 'tool_use', 'tool-call', 'toolcall', 'tool_calls', 'toolcalls'].includes(stopReason)) {
    return false;
  }

  const marker = String(payload.phase || payload.state || payload.status || payload.kind || payload.type || '').toLowerCase();
  if (['complete', 'completed', 'done', 'end', 'final', 'finished', 'ok'].includes(marker)) {
    return true;
  }

  return Boolean(stopReason && stopReason !== 'in_progress');
}

function isErrorPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const marker = String(payload.phase || payload.state || payload.status || payload.kind || payload.type || '').toLowerCase();
  if (marker === 'error' || Boolean(payload.error)) {
    return true;
  }

  const stopReason = String(payload?.message?.stopReason || '').toLowerCase();
  return stopReason === 'error' || Boolean(extractErrorMessage(payload));
}

export class BridgeWSServer {
  #activeSessionOwners = new Map();
  #clientStates = new Map();
  #config;
  #gatewayClient;
  #globalGatewayUnsubscribe = null;
  #heartbeatTimer = null;
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
    this.#startServerHeartbeat();
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
        activeToolCallId: '',
        clientId,
        conversationId: '',
        modelRef: normalizeConfiguredModelRef(this.#config.getConfig(), this.#config.getPrimaryModel()) || '',
        sessionKey: '',
        subscriptionStop: null,
        ws,
      });
      ws.__modelhubMissedPongs = 0;

      ws.on('pong', () => {
        ws.__modelhubMissedPongs = 0;
      });

      const currentPrimary = normalizeConfiguredModelRef(this.#config.getConfig(), this.#config.getPrimaryModel())
        || this.#config.getPrimaryModel()
        || '';

      this.#send(ws, {
        // bridgeToken: token compartilhado entre WS hello (origin-gated) e
        // rotas HTTP mutaveis (Bearer). Permite que o fallback HTTP do
        // browser autentique sem hardcoding nem CSRF. CLIs locais usam o
        // mesmo token via openclaw.json.
        bridgeToken: this.#config.gatewayToken || '',
        bridgeId: this.#config.bridgeId,
        gateway: { ok: this.#gatewayClient.connected, ws: this.#gatewayClient.connected },
        model: { primary: currentPrimary },
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

  #startServerHeartbeat() {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
    }
    this.#heartbeatTimer = setInterval(() => this.#heartbeatTick(), BROWSER_WS_HEARTBEAT_INTERVAL_MS);
    this.#heartbeatTimer.unref?.();
  }

  #heartbeatTick() {
    if (!this.#wss) {
      return;
    }
    for (const ws of this.#wss.clients) {
      if (ws.readyState !== 1) {
        continue;
      }
      // O pong handler zera __modelhubMissedPongs; aqui contamos rounds
      // sem resposta. Limite atingido => derruba a conexao.
      const missed = (ws.__modelhubMissedPongs || 0) + 1;
      if (missed > BROWSER_WS_HEARTBEAT_MAX_MISSES) {
        this.#terminateWs(ws);
        continue;
      }
      ws.__modelhubMissedPongs = missed;
      try {
        ws.ping();
      } catch {
        this.#terminateWs(ws);
      }
    }
  }

  #terminateWs(ws) {
    if (typeof ws.terminate === 'function') {
      ws.terminate();
    } else {
      ws.close();
    }
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
            model: { primary: this.#config.getPrimaryModel() },
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
      this.#clearActiveOwner(state);
    }
  }

  async #handleSessionEnsure(state, msg, { announceReady = true } = {}) {
    const conversationId = String(msg.conversationId || state.conversationId || randomUUID());
    const requestedSessionKey = String(msg.sessionKey || state.sessionKey || `modelhub:${conversationId}`);
    const modelRef = await this.#resolveRequestedModelRef(state, msg.model, {
      persistIfChanged: Boolean(msg.model),
    });

    let session = await this.#gatewayClient.sessionGet(requestedSessionKey);
    if (!session?.sessionKey) {
      try {
        session = await this.#gatewayClient.sessionCreate({
          label: conversationId,
          model: modelRef ? { primary: modelRef } : undefined,
          sessionKey: requestedSessionKey,
        });
      } catch (error) {
        session = await this.#gatewayClient.sessionGet(requestedSessionKey, { timeout: 5000 });
        if (!session?.sessionKey) {
          throw error;
        }
      }
    }

    if (state.sessionKey && state.sessionKey !== session.sessionKey) {
      this.#clearActiveOwner(state, state.sessionKey);
    }

    if (state.subscriptionStop && state.sessionKey && state.sessionKey !== session.sessionKey) {
      await state.subscriptionStop();
      state.subscriptionStop = null;
    }

    if (!state.subscriptionStop || state.sessionKey !== session.sessionKey) {
      state.subscriptionStop = await this.#gatewayClient.subscribeSession(session.sessionKey, NOOP_EVENT_HANDLER);
    }

    state.conversationId = conversationId;
    state.modelRef = modelRef || state.modelRef;
    state.sessionKey = session.sessionKey;

    if (announceReady) {
      this.#send(state.ws, {
        conversationId,
        requestId: msg.requestId,
        sessionKey: session.sessionKey,
        type: 'session.ready',
      });
    }
  }

  async #handleChatSend(state, msg) {
    const modelRef = await this.#resolveRequestedModelRef(state, msg.model, {
      persistIfChanged: Boolean(msg.model),
      required: true,
    });

    state.activeRequestId = String(msg.requestId || randomUUID());
    state.activeRunId = '';
    state.activeToolCallId = '';
    this.#sendRunStatus(state, {
      detail: { conversationId: msg.conversationId, model: modelRef || null },
      label: 'OpenClaw: preparando sessao',
      step: 'session',
    });

    // chat.send ja anuncia atividade via run.status; nao reemita session.ready
    // para evitar dois eventos para a mesma operacao.
    await this.#handleSessionEnsure(state, {
      conversationId: msg.conversationId,
      model: modelRef,
      requestId: state.activeRequestId,
      sessionKey: msg.sessionKey,
    }, { announceReady: false });
    this.#markActiveOwner(state);

    if (modelRef) {
      this.#sendRunStatus(state, {
        detail: { model: modelRef },
        label: 'OpenClaw: selecionando modelo',
        step: 'model',
      });
      await this.#gatewayClient.sessionPatch(state.sessionKey, {
        model: { primary: modelRef },
      });
      this.#sendRunStatus(state, {
        detail: { model: modelRef },
        label: 'OpenClaw: modelo selecionado',
        status: 'completed',
        step: 'model',
      });
    }

    this.#sendRunStatus(state, {
      label: 'OpenClaw: enviando mensagem',
      step: 'send',
    });
    const result = await this.#gatewayClient.sessionSend(
      state.sessionKey,
      String(msg.content || msg.text || ''),
      { idempotencyKey: state.activeRequestId },
    );

    const runId = extractRunId(result);
    if (runId) {
      state.activeRunId = runId;
    }

    this.#sendRunStatus(state, {
      detail: runId ? { runId } : undefined,
      label: 'OpenClaw: aguardando eventos',
      step: 'wait',
    });

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
      this.#clearActiveOwner(state);
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
    this.#clearActiveOwner(state);
    state.activeRunId = '';
  }

  async #handleModelChange(state, msg) {
    const modelRef = await this.#resolveRequestedModelRef(state, String(msg.model || msg.primary || ''), {
      persistIfChanged: true,
      required: true,
    });
    if (!modelRef) {
      throw new Error('Missing model');
    }

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

  async #resolveRequestedModelRef(state, requestedModelRef, options = {}) {
    const { persistIfChanged = false, required = false } = options;
    const modelRef = requestedModelRef
      ? normalizeModelRef(requestedModelRef)
      : '';

    const currentPrimary =
      normalizeConfiguredModelRef(this.#config.getConfig(), this.#config.getPrimaryModel())
      || normalizeModelRef(state.modelRef)
      || '';
    const resolved = modelRef || currentPrimary || '';

    if (!resolved && required) {
      throw new Error('Nenhum modelo OpenClaw foi configurado para esta integracao local.');
    }

    if (persistIfChanged && resolved && resolved !== currentPrimary) {
      await this.#config.changeModel(resolved);
    }

    if (resolved) {
      state.modelRef = resolved;
    }

    return resolved || undefined;
  }

  async #handleToolApproval(state, msg) {
    if (!msg.approvalId) {
      throw new Error('Missing approvalId');
    }

    await this.#gatewayClient.approvalResolve(msg.approvalId, msg.approved !== false, msg.reason);
    this.#sendRunStatus(state, {
      detail: { approvalId: msg.approvalId, approved: msg.approved !== false },
      label: 'OpenClaw: aprovacao respondida',
      status: 'completed',
      step: 'approval',
    });
    this.#send(state.ws, {
      approvalId: msg.approvalId,
      requestId: msg.requestId,
      runId: state.activeRunId || undefined,
      type: 'tool.approval.resolved',
    });
  }

  #handleGatewayEvent(event) {
    const parsedPayload = parseBridgeEventPayload(event.event, event.payload);
    if (!parsedPayload.ok) {
      this.#log.warn(`[gw-event] invalid payload for ${event.event}: ${parsedPayload.error}`);
      return;
    }

    const payload = parsedPayload.payload;
    const sessionKey = extractSessionKey(payload);
    const approvalId = extractApprovalId(payload);

    for (const state of this.#statesForGatewayEvent(sessionKey)) {
      if (event.event === 'session.message') {
        this.#forwardSessionMessage(state, payload);
      } else if (event.event === 'session.tool') {
        this.#forwardSessionTool(state, payload);
      } else if (event.event === 'exec.approval.requested' && approvalId) {
        this.#sendRunStatus(state, {
          detail: { approvalId },
          label: 'OpenClaw: aguardando aprovacao',
          runId: extractRunId(payload) || state.activeRunId || undefined,
          step: 'approval',
        });
        this.#send(state.ws, {
          approvalId,
          args: payload?.systemRunPlan || {
            argv: payload?.argv,
            command: payload?.command,
            cwd: payload?.cwd,
            rawCommand: payload?.rawCommand,
          },
          requestId: state.activeRequestId || undefined,
          runId: extractRunId(payload) || state.activeRunId || undefined,
          toolCallId: approvalId,
          toolName: 'system.run',
          type: 'tool.approval.requested',
        });
      } else if (event.event === 'exec.approval.resolved' && approvalId) {
        this.#sendRunStatus(state, {
          detail: { approvalId },
          label: 'OpenClaw: aprovacao respondida',
          runId: extractRunId(payload) || state.activeRunId || undefined,
          status: 'completed',
          step: 'approval',
        });
        this.#send(state.ws, {
          approvalId,
          requestId: state.activeRequestId || undefined,
          runId: extractRunId(payload) || state.activeRunId || undefined,
          type: 'tool.approval.resolved',
        });
      }
    }
  }

  #markActiveOwner(state) {
    if (state.sessionKey && state.clientId) {
      this.#activeSessionOwners.set(state.sessionKey, state.clientId);
    }
  }

  #clearActiveOwner(state, sessionKey = state.sessionKey) {
    if (!sessionKey) {
      return;
    }
    if (this.#activeSessionOwners.get(sessionKey) === state.clientId) {
      this.#activeSessionOwners.delete(sessionKey);
    }
  }

  #statesForGatewayEvent(sessionKey) {
    if (!sessionKey) {
      // Sem sessionKey nao podemos rotear com seguranca: dispatcher anterior
      // fazia broadcast e vazava streams entre abas/clientes diferentes.
      return [];
    }

    const ownerId = this.#activeSessionOwners.get(sessionKey);
    if (ownerId) {
      const owner = this.#clientStates.get(ownerId);
      if (owner?.sessionKey === sessionKey) {
        return [owner];
      }
      this.#activeSessionOwners.delete(sessionKey);
    }

    return [...this.#clientStates.values()].filter((state) => state.sessionKey === sessionKey);
  }

  #forwardSessionMessage(state, payload) {
    const runId = extractRunId(payload) || state.activeRunId || undefined;
    if (runId) {
      state.activeRunId = runId;
    }

    const role = extractMessageRole(payload).toLowerCase();
    const toolResult = extractToolResultMessagePayload(payload);
    if (toolResult) {
      if (state.activeToolCallId === toolResult.toolCallId) {
        state.activeToolCallId = '';
      }
      this.#sendRunStatus(state, {
        detail: { toolCallId: toolResult.toolCallId, toolName: toolResult.toolName },
        label: 'OpenClaw: ferramenta concluiu',
        runId,
        status: 'completed',
        step: 'tool',
      });
      this.#send(state.ws, {
        ...toolResult,
        requestId: state.activeRequestId || undefined,
        runId,
        status: 'completed',
        type: 'tool.update',
      });
      return;
    }

    if (role && role !== 'assistant') {
      return;
    }

    const toolCalls = extractToolCallPayloads(payload);
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        state.activeToolCallId = toolCall.toolCallId;
        this.#sendRunStatus(state, {
          detail: { toolName: toolCall.toolName },
          label: 'OpenClaw: executando ferramenta',
          runId,
          step: 'tool',
        });
        this.#send(state.ws, {
          ...toolCall,
          requestId: state.activeRequestId || undefined,
          runId,
          type: 'tool.update',
        });
      }
    }

    const text = extractTextPayload(payload);
    if (text) {
      this.#sendRunStatus(state, {
        label: 'OpenClaw: recebendo resposta',
        runId,
        step: 'response',
      });
      this.#send(state.ws, {
        delta: text,
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'chat.delta',
      });
    }

    if (toolCalls.length > 0 && !text) {
      return;
    }

    if (isErrorPayload(payload)) {
      const rawError = extractErrorMessage(payload) || 'Session error';
      if (isModelHubApiKeyError(rawError)) {
        void this.#config.handleAuthError?.({
          error: rawError,
          modelRef: state.modelRef || undefined,
        });
      }

      this.#sendRunStatus(state, {
        detail: rawError,
        label: 'OpenClaw: erro na execucao',
        runId,
        status: 'error',
        step: 'run',
      });
      this.#send(state.ws, {
        error: isModelHubApiKeyError(rawError)
          ? 'A API Key do ModelHub esta ausente ou invalida. O CLI local pediu uma nova chave no terminal. Depois de atualizar, envie a mensagem novamente.'
          : rawError,
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'run.error',
      });
      this.#clearActiveOwner(state);
      return;
    }

    if (isFinalPayload(payload)) {
      this.#sendRunStatus(state, {
        label: 'OpenClaw: execucao concluida',
        runId,
        status: 'completed',
        step: 'run',
      });
      this.#send(state.ws, {
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'run.completed',
      });
      this.#clearActiveOwner(state);
    }
  }

  #forwardSessionTool(state, payload) {
    const runId = extractRunId(payload) || state.activeRunId || undefined;
    if (runId) {
      state.activeRunId = runId;
    }

    const approvalId = extractApprovalId(payload);
    if (approvalId) {
      this.#sendRunStatus(state, {
        detail: { approvalId },
        label: 'OpenClaw: aguardando aprovacao',
        runId,
        step: 'approval',
      });
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
      state.activeToolCallId = toolStart.toolCallId;
      this.#sendRunStatus(state, {
        detail: { toolName: toolStart.toolName },
        label: 'OpenClaw: executando ferramenta',
        runId,
        step: 'tool',
      });
      this.#send(state.ws, {
        ...toolStart,
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'tool.update',
      });
    }

    const toolResult = extractToolResultPayload(payload);
    if (toolResult) {
      if (state.activeToolCallId === toolResult.toolCallId) {
        state.activeToolCallId = '';
      }
      this.#sendRunStatus(state, {
        detail: { toolCallId: toolResult.toolCallId },
        label: 'OpenClaw: ferramenta concluiu',
        runId,
        status: 'completed',
        step: 'tool',
      });
      this.#send(state.ws, {
        ...toolResult,
        requestId: state.activeRequestId || undefined,
        runId,
        status: 'completed',
        type: 'tool.update',
      });
    }

    if (isFinalPayload(payload)) {
      this.#sendRunStatus(state, {
        label: 'OpenClaw: execucao concluida',
        runId,
        status: 'completed',
        step: 'run',
      });
      this.#send(state.ws, {
        requestId: state.activeRequestId || undefined,
        runId,
        type: 'run.completed',
      });
      this.#clearActiveOwner(state);
    }
  }

  async #cleanupClient(clientId) {
    const state = this.#clientStates.get(clientId);
    if (!state) {
      return;
    }
    this.#clearActiveOwner(state);
    this.#clientStates.delete(clientId);
    if (state.subscriptionStop) {
      try {
        await state.subscriptionStop();
      } catch (error) {
        this.#log.debug?.(`[ws] Failed to unsubscribe session ${state.sessionKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
      state.subscriptionStop = null;
    }
    if (state.sessionKey && !this.#hasLiveClientForSession(state.sessionKey)) {
      this.#activeSessionOwners.delete(state.sessionKey);
    }
  }

  #hasLiveClientForSession(sessionKey) {
    for (const state of this.#clientStates.values()) {
      if (state.sessionKey === sessionKey && state.ws.readyState === 1) {
        return true;
      }
    }
    return false;
  }

  #sendRunStatus(state, input) {
    this.#send(state.ws, {
      detail: input.detail,
      label: input.label,
      requestId: state.activeRequestId || input.requestId || undefined,
      runId: input.runId || state.activeRunId || undefined,
      status: input.status || 'running',
      step: input.step,
      type: 'run.status',
    });
  }

  handleGatewayLogLine({ line, source } = {}) {
    const failure = extractGatewayToolFailure(line);
    if (!failure) {
      return;
    }

    const errorMessage = `Falha da ferramenta OpenClaw: ${failure.message}`;
    for (const state of this.#clientStates.values()) {
      if (!state.activeRequestId) {
        continue;
      }
      const toolCallId = state.activeToolCallId || `gateway-log:${randomUUID()}`;
      const detail = {
        args: failure.args,
        message: failure.message,
        source: source || 'gateway',
      };

      this.#sendRunStatus(state, {
        detail,
        label: 'OpenClaw: ferramenta falhou',
        status: 'error',
        step: 'tool',
      });
      this.#send(state.ws, {
        requestId: state.activeRequestId || undefined,
        result: detail,
        runId: state.activeRunId || undefined,
        status: 'error',
        toolCallId,
        toolName: 'tool',
        type: 'tool.update',
      });
      this.#sendRunStatus(state, {
        detail: errorMessage,
        label: 'OpenClaw: erro na execucao',
        status: 'error',
        step: 'run',
      });
      this.#send(state.ws, {
        error: errorMessage,
        requestId: state.activeRequestId || undefined,
        runId: state.activeRunId || undefined,
        type: 'run.error',
      });
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
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

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
    this.#activeSessionOwners.clear();
  }
}
