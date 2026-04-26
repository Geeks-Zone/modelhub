import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { BridgeWSServer } from './bridge-ws.mjs';

function waitFor(assertion, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const tick = () => {
      if (assertion()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 10);
    };

    tick();
  });
}

class GatewayClientStub {
  connected = true;
  #eventHandlers = new Set();
  #sessionHandlers = new Map();

  constructor() {
    this.sessionPatch = vi.fn(async (sessionKey, patch) => {
      this.lastPatch = { patch, sessionKey };
      return {};
    });
    this.sessionCreate = vi.fn(async ({ model, sessionKey }) => {
      this.createdSessions.push({ model, sessionKey });
      return { id: sessionKey, sessionKey };
    });
  }

  approvalResolve = vi.fn(async () => {})

  createdSessions = []

  emit(event) {
    for (const handler of this.#eventHandlers) {
      handler(event);
    }

    const sessionKey = event?.payload?.sessionKey;
    const sessionHandlers = sessionKey ? this.#sessionHandlers.get(sessionKey) : null;
    if (!sessionHandlers) {
      return;
    }

    for (const handler of sessionHandlers) {
      handler(event);
    }
  }

  onEvent(handler) {
    this.#eventHandlers.add(handler);
    return () => {
      this.#eventHandlers.delete(handler);
    };
  }

  sessionAbort = vi.fn(async () => {})

  async sessionGet() {
    return null;
  }

  async sessionSend(sessionKey, content, options = {}) {
    this.lastSend = { content, options, sessionKey };
    return { runId: 'run-1', status: 'started' };
  }

  async subscribeSession(sessionKey, handler) {
    const handlers = this.#sessionHandlers.get(sessionKey) ?? new Set();
    handlers.add(handler);
    this.#sessionHandlers.set(sessionKey, handlers);

    return async () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.#sessionHandlers.delete(sessionKey);
      }
    };
  }

  handlerCount(sessionKey) {
    return this.#sessionHandlers.get(sessionKey)?.size ?? 0;
  }
}

async function connectBrowser(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  const receivedMessages = [];
  socket.on('message', (data) => {
    receivedMessages.push(JSON.parse(data.toString()));
  });

  await waitFor(() => receivedMessages.some((message) => message.type === 'hello'));

  return { receivedMessages, socket };
}

async function createBridgeHarness(overrides = {}) {
  const gatewayClient = new GatewayClientStub();
  const changeModel = overrides.changeModel ?? vi.fn(async () => {});
  const handleAuthError = overrides.handleAuthError ?? vi.fn(async () => true);
  const config = overrides.config ?? {
    agents: {
      defaults: {
        model: {
          primary: 'modelhub/openrouter/openai/gpt-oss-20b:free',
        },
      },
    },
    models: {
      providers: {
        modelhub: {
          models: [],
        },
      },
    },
  };
  const bridgeWs = new BridgeWSServer(
    gatewayClient,
    {
      bridgeId: 'bridge-test',
      changeModel,
      getConfig: () => config,
      getPrimaryModel: () => config?.agents?.defaults?.model?.primary ?? null,
      handleAuthError,
    },
    {
      debug() {},
      info() {},
      warn() {},
    },
  );
  const httpServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  await bridgeWs.attach(httpServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  const { port } = httpServer.address();
  const { receivedMessages, socket } = await connectBrowser(port);

  return {
    bridgeWs,
    changeModel,
    connectBrowser: () => connectBrowser(port),
    cleanup: async () => {
      socket.close();
      await bridgeWs.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
    config,
    gatewayClient,
    handleAuthError,
    port,
    receivedMessages,
    socket,
  };
}

describe('BridgeWSServer', () => {
  it('sends hello with model primary and passes through any model from chat payload', async () => {
    const harness = await createBridgeHarness();

    try {
      const hello = harness.receivedMessages.find((message) => message.type === 'hello');
      expect(hello).toEqual(expect.objectContaining({
        model: { primary: 'modelhub/openrouter/openai/gpt-oss-20b:free' },
        type: 'hello',
      }));
      expect(hello).not.toHaveProperty('models');

      harness.socket.send(JSON.stringify({
        content: 'Oi',
        conversationId: 'conv-1',
        model: 'gateway/openai/gpt-5-mini',
        requestId: 'req-1',
        type: 'chat.send',
      }));

      await waitFor(() => harness.gatewayClient.lastSend?.sessionKey === 'modelhub:conv-1');
      await waitFor(() => harness.receivedMessages.some((message) => message.type === 'run.status' && message.step === 'wait'));

      expect(harness.changeModel).toHaveBeenCalledWith('modelhub/gateway/openai/gpt-5-mini');
      expect(harness.gatewayClient.createdSessions).toEqual([
        {
          model: { primary: 'modelhub/gateway/openai/gpt-5-mini' },
          sessionKey: 'modelhub:conv-1',
        },
      ]);
      expect(harness.gatewayClient.sessionPatch).toHaveBeenCalledWith('modelhub:conv-1', {
        model: { primary: 'modelhub/gateway/openai/gpt-5-mini' },
      });
      expect(harness.receivedMessages.filter((message) => message.type === 'run.status')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'OpenClaw: preparando sessao', requestId: 'req-1', step: 'session' }),
          expect.objectContaining({ label: 'OpenClaw: modelo selecionado', requestId: 'req-1', status: 'completed', step: 'model' }),
          expect.objectContaining({ label: 'OpenClaw: enviando mensagem', requestId: 'req-1', step: 'send' }),
          expect.objectContaining({ label: 'OpenClaw: aguardando eventos', requestId: 'req-1', step: 'wait' }),
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('ignores echoed user events and surfaces assistant auth errors clearly', async () => {
    const harness = await createBridgeHarness();

    try {
      harness.socket.send(JSON.stringify({
        content: 'Quem e vc?',
        conversationId: 'conv-1',
        model: 'modelhub/openrouter/openai/gpt-oss-20b:free',
        requestId: 'req-1',
        type: 'chat.send',
      }));
      await waitFor(() => harness.gatewayClient.lastSend?.sessionKey === 'modelhub:conv-1');

      harness.gatewayClient.emit({
        event: 'session.message',
        payload: {
          message: {
            content: 'Quem e vc?',
            role: 'user',
          },
          runId: 'run-1',
          sessionKey: 'modelhub:conv-1',
          status: 'running',
        },
        type: 'event',
      });
      harness.gatewayClient.emit({
        event: 'session.message',
        payload: {
          message: {
            content: [],
            errorMessage: '401 "Invalid or revoked API key"',
            role: 'assistant',
            stopReason: 'error',
          },
          runId: 'run-1',
          sessionKey: 'modelhub:conv-1',
          status: 'completed',
        },
        type: 'event',
      });

      await waitFor(() => harness.receivedMessages.some((message) => message.type === 'run.error'));

      expect(harness.receivedMessages.filter((message) => message.type === 'chat.delta')).toEqual([]);
      expect(harness.receivedMessages.find((message) => message.type === 'run.error')).toEqual(
        expect.objectContaining({
          error: 'A API Key do ModelHub esta ausente ou invalida. O CLI local pediu uma nova chave no terminal. Depois de atualizar, envie a mensagem novamente.',
          requestId: 'req-1',
          type: 'run.error',
        }),
      );
      expect(harness.handleAuthError).toHaveBeenCalledWith({
        error: '401 "Invalid or revoked API key"',
        modelRef: 'modelhub/openrouter/openai/gpt-oss-20b:free',
      });
    } finally {
      await harness.cleanup();
    }
  });

  it('normalizes model refs without modelhub prefix', async () => {
    const harness = await createBridgeHarness();

    try {
      harness.socket.send(JSON.stringify({
        content: 'Oi',
        conversationId: 'conv-2',
        model: 'deepseek/deepseek-chat',
        requestId: 'req-2',
        type: 'chat.send',
      }));

      await waitFor(() => harness.gatewayClient.lastSend?.sessionKey === 'modelhub:conv-2');

      expect(harness.changeModel).toHaveBeenCalledWith('modelhub/deepseek/deepseek-chat');
    } finally {
      await harness.cleanup();
    }
  });

  it('routes session events only to the active owner when two tabs share a conversation', async () => {
    const harness = await createBridgeHarness();
    const second = await harness.connectBrowser();

    try {
      second.socket.send(JSON.stringify({
        conversationId: 'conv-shared',
        model: 'modelhub/openrouter/openai/gpt-oss-20b:free',
        requestId: 'ensure-tab-2',
        type: 'session.ensure',
      }));
      await waitFor(() => second.receivedMessages.some((message) => message.type === 'session.ready'));

      harness.socket.send(JSON.stringify({
        content: 'Oi',
        conversationId: 'conv-shared',
        model: 'modelhub/openrouter/openai/gpt-oss-20b:free',
        requestId: 'req-owner',
        type: 'chat.send',
      }));
      await waitFor(() => harness.gatewayClient.lastSend?.sessionKey === 'modelhub:conv-shared');

      harness.gatewayClient.emit({
        event: 'session.message',
        payload: {
          message: {
            content: 'Resposta unica',
            role: 'assistant',
          },
          runId: 'run-shared',
          sessionKey: 'modelhub:conv-shared',
          status: 'running',
        },
        type: 'event',
      });

      await waitFor(() => harness.receivedMessages.some((message) => message.type === 'chat.delta'));

      expect(harness.receivedMessages.filter((message) => message.type === 'chat.delta')).toEqual([
        expect.objectContaining({
          delta: 'Resposta unica',
          requestId: 'req-owner',
          type: 'chat.delta',
        }),
      ]);
      expect(second.receivedMessages.filter((message) => message.type === 'chat.delta')).toEqual([]);
    } finally {
      second.socket.close();
      await harness.cleanup();
    }
  });

  it('removes active ownership and session subscriptions when a browser closes', async () => {
    const harness = await createBridgeHarness();

    try {
      harness.socket.send(JSON.stringify({
        content: 'Oi',
        conversationId: 'conv-cleanup',
        model: 'modelhub/openrouter/openai/gpt-oss-20b:free',
        requestId: 'req-cleanup',
        type: 'chat.send',
      }));
      await waitFor(() => harness.gatewayClient.lastSend?.sessionKey === 'modelhub:conv-cleanup');
      expect(harness.gatewayClient.handlerCount('modelhub:conv-cleanup')).toBe(1);

      harness.socket.close();
      await waitFor(() => harness.gatewayClient.handlerCount('modelhub:conv-cleanup') === 0);

      harness.gatewayClient.emit({
        event: 'session.message',
        payload: {
          message: {
            content: 'Nao deve entregar',
            role: 'assistant',
          },
          runId: 'run-cleanup',
          sessionKey: 'modelhub:conv-cleanup',
          status: 'running',
        },
        type: 'event',
      });

      expect(harness.receivedMessages.filter((message) => message.type === 'chat.delta')).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it('does not complete the browser run while an embedded tool call is still in progress', async () => {
    const harness = await createBridgeHarness();

    try {
      harness.socket.send(JSON.stringify({
        content: 'Qual ocupa mais memoria?',
        conversationId: 'conv-tools',
        model: 'modelhub/googleaistudio/gemini-2.5-flash',
        requestId: 'req-tools',
        type: 'chat.send',
      }));
      await waitFor(() => harness.gatewayClient.lastSend?.sessionKey === 'modelhub:conv-tools');

      harness.gatewayClient.emit({
        event: 'session.message',
        payload: {
          message: {
            content: [
              {
                arguments: { command: 'tasklist /FO CSV /NH' },
                id: 'tool-1',
                name: 'exec',
                type: 'toolCall',
              },
            ],
            role: 'assistant',
            stopReason: 'toolUse',
          },
          runId: 'run-tools',
          sessionKey: 'modelhub:conv-tools',
          status: 'completed',
        },
        type: 'event',
      });

      await waitFor(() => harness.receivedMessages.some((message) => message.type === 'tool.update'));
      expect(harness.receivedMessages.filter((message) => message.type === 'run.completed')).toEqual([]);
      expect(harness.receivedMessages.find((message) => message.type === 'tool.update')).toEqual(
        expect.objectContaining({
          args: { command: 'tasklist /FO CSV /NH' },
          requestId: 'req-tools',
          toolCallId: 'tool-1',
          toolName: 'exec',
          type: 'tool.update',
        }),
      );

      harness.gatewayClient.emit({
        event: 'session.message',
        payload: {
          message: {
            content: [{ text: 'node.exe usa mais memoria.', type: 'text' }],
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'exec',
          },
          runId: 'run-tools',
          sessionKey: 'modelhub:conv-tools',
          status: 'completed',
        },
        type: 'event',
      });
      harness.gatewayClient.emit({
        event: 'session.message',
        payload: {
          message: {
            content: [{ text: 'O processo que mais usa memoria e node.exe.', type: 'text' }],
            role: 'assistant',
            stopReason: 'stop',
          },
          runId: 'run-tools',
          sessionKey: 'modelhub:conv-tools',
          status: 'completed',
        },
        type: 'event',
      });

      await waitFor(() => harness.receivedMessages.some((message) => message.type === 'run.completed'));
      expect(harness.receivedMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            result: 'node.exe usa mais memoria.',
            status: 'completed',
            toolCallId: 'tool-1',
            type: 'tool.update',
          }),
          expect.objectContaining({
            delta: 'O processo que mais usa memoria e node.exe.',
            requestId: 'req-tools',
            type: 'chat.delta',
          }),
          expect.objectContaining({
            requestId: 'req-tools',
            type: 'run.completed',
          }),
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  });
});
