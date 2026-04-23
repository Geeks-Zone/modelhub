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

  it('resolves approvals with the new id/decision params', async () => {
    const client = createClient();
    client.request = vi.fn().mockResolvedValue({});

    await client.approvalResolve('approval-1', true);

    expect(client.request).toHaveBeenCalledWith('exec.approval.resolve', {
      decision: 'allow-once',
      id: 'approval-1',
    });
  });
});
