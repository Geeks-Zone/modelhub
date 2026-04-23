import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';
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

  async approvalResolve() {}

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

  async sessionAbort() {}

  async sessionCreate({ sessionKey }) {
    return { id: sessionKey, sessionKey };
  }

  async sessionGet() {
    return null;
  }

  async sessionPatch() {}

  async sessionSend(sessionKey, content, options = {}) {
    this.lastSend = { content, options, sessionKey };
    return { runId: 'run-1' };
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
}

describe('BridgeWSServer', () => {
  it('does not forward duplicate gateway events when both routing paths fire', async () => {
    const gatewayClient = new GatewayClientStub();
    const bridgeWs = new BridgeWSServer(
      gatewayClient,
      {
        bridgeId: 'bridge-test',
        async changeModel() {},
        getConfig: () => ({
          models: {
            providers: {
              modelhub: {
                models: [{ id: 'openrouter/openai/gpt-oss-20b:free', name: 'GPT OSS 20B' }],
              },
            },
          },
        }),
        getPrimaryModel: () => 'modelhub/openrouter/openai/gpt-oss-20b:free',
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
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    const receivedMessages = [];

    socket.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    try {
      await waitFor(() => receivedMessages.some((message) => message.type === 'hello'));

      socket.send(JSON.stringify({
        conversationId: 'conv-1',
        requestId: 'ensure-1',
        type: 'session.ensure',
      }));
      await waitFor(() => receivedMessages.some((message) => message.type === 'session.ready'));

      socket.send(JSON.stringify({
        content: 'Oi',
        conversationId: 'conv-1',
        requestId: 'req-1',
        type: 'chat.send',
      }));
      await waitFor(() => gatewayClient.lastSend?.sessionKey === 'modelhub:conv-1');

      gatewayClient.emit({
        event: 'session.message',
        payload: {
          delta: 'Hello from bridge',
          requestId: 'req-1',
          runId: 'run-1',
          sessionKey: 'modelhub:conv-1',
          status: 'running',
        },
        type: 'event',
      });
      gatewayClient.emit({
        event: 'session.message',
        payload: {
          requestId: 'req-1',
          runId: 'run-1',
          sessionKey: 'modelhub:conv-1',
          status: 'completed',
        },
        type: 'event',
      });

      await waitFor(() => receivedMessages.filter((message) => message.type === 'run.completed').length === 1);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedMessages.filter((message) => message.type === 'chat.delta')).toEqual([
        expect.objectContaining({
          delta: 'Hello from bridge',
          requestId: 'req-1',
          type: 'chat.delta',
        }),
      ]);
      expect(receivedMessages.filter((message) => message.type === 'run.completed')).toHaveLength(1);
    } finally {
      socket.close();
      await bridgeWs.close();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
});
