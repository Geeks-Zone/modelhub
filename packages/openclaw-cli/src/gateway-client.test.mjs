import { describe, expect, it, vi } from 'vitest';

import { GatewayClient } from './gateway-client.mjs';

function createClient() {
  return new GatewayClient('http://127.0.0.1:18789', 'gw-token', {
    debug() {},
    info() {},
    warn() {},
  });
}

describe('GatewayClient request normalization', () => {
  it('exposes a safe status snapshot without private fields', () => {
    const client = createClient();

    expect(client.status).toEqual({
      connected: false,
      lastError: null,
      reconnectAttempt: 0,
      reconnecting: false,
    });
  });

  it('creates sessions with key/model in the current gateway shape', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({ key: 'modelhub:conv-1', sessionKey: 'modelhub:conv-1' });

    await client.sessionCreate({
      label: 'conv-1',
      model: { primary: 'modelhub/openai/gpt-4.1' },
      sessionKey: 'modelhub:conv-1',
    });

    expect(client.request).toHaveBeenCalledWith('sessions.create', {
      key: 'modelhub:conv-1',
      label: 'conv-1',
      model: 'modelhub/openai/gpt-4.1',
    });
  });

  it('checks existing sessions with a short timeout so session.ensure does not stall on cold boot', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({ key: 'modelhub:conv-1', sessionKey: 'modelhub:conv-1' });

    await client.sessionGet('modelhub:conv-1');

    expect(client.request).toHaveBeenCalledWith('sessions.get', {
      key: 'modelhub:conv-1',
    }, {
      timeout: 2500,
    });
  });

  it('patches sessions using key and a string model selection', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({});

    await client.sessionPatch('modelhub:conv-1', {
      model: { primary: 'modelhub/openai/gpt-4.1-mini' },
      thinkingLevel: 'high',
    });

    expect(client.request).toHaveBeenCalledWith('sessions.patch', {
      key: 'modelhub:conv-1',
      model: 'modelhub/openai/gpt-4.1-mini',
      thinkingLevel: 'high',
    });
  });

  it('sends chat using the string message payload expected by chat.send', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({ runId: 'run-1' });

    await client.sessionSend('modelhub:conv-1', { content: 'Oi' }, { idempotencyKey: 'req-1' });

    expect(client.request).toHaveBeenCalledWith('chat.send', {
      idempotencyKey: 'req-1',
      message: 'Oi',
      sessionKey: 'modelhub:conv-1',
    }, { timeout: null });
  });

  it('subscribes and unsubscribes sessions with the gateway key field', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({});
    const handler = vi.fn();

    const unsubscribe = await client.subscribeSession('modelhub:conv-1', handler);
    await unsubscribe();

    expect(client.request).toHaveBeenNthCalledWith(1, 'sessions.messages.subscribe', {
      key: 'modelhub:conv-1',
    });
    expect(client.request).toHaveBeenNthCalledWith(2, 'sessions.messages.unsubscribe', {
      key: 'modelhub:conv-1',
    });
  });

  it('resolves approvals with the new id/decision params', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({});

    await client.approvalResolve('approval-1', true);

    expect(client.request).toHaveBeenCalledWith('exec.approval.resolve', {
      decision: 'allow-once',
      id: 'approval-1',
    });
  });

  it('forwards a deny reason to the gateway when provided', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({});

    await client.approvalResolve('approval-2', false, 'Too risky');

    expect(client.request).toHaveBeenCalledWith('exec.approval.resolve', {
      decision: 'deny',
      id: 'approval-2',
      reason: 'Too risky',
    });
  });

  it('omits an empty or whitespace-only reason', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({});

    await client.approvalResolve('approval-3', true, '   ');

    expect(client.request).toHaveBeenCalledWith('exec.approval.resolve', {
      decision: 'allow-once',
      id: 'approval-3',
    });
  });
});
