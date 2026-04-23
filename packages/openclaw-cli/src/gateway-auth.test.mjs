import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildGatewayConnectParams,
  loadOrCreateDeviceIdentity,
  resolveOpenClawDeviceIdentityPath,
  resolveOpenClawStateDir,
} from './gateway-auth.mjs';

describe('gateway-auth helpers', () => {
  it('derives the state directory from OPENCLAW_CONFIG_PATH first', () => {
    expect(resolveOpenClawStateDir({
      OPENCLAW_CONFIG_PATH: '/tmp/openclaw/custom.json',
      OPENCLAW_STATE_DIR: '/tmp/openclaw/state',
    })).toBe(path.dirname(path.resolve('/tmp/openclaw/custom.json')));
  });

  it('stores and reuses the generated device identity', () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), 'openclaw-auth-'));
    const env = { OPENCLAW_STATE_DIR: stateDir };

    const first = loadOrCreateDeviceIdentity({ env });
    const second = loadOrCreateDeviceIdentity({ env });
    const stored = JSON.parse(readFileSync(resolveOpenClawDeviceIdentityPath(env), 'utf8'));

    expect(second).toEqual(first);
    expect(stored.deviceId).toBe(first.deviceId);
    expect(stored.version).toBe(1);
  });

  it('builds connect params with the current gateway-client handshake', () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), 'openclaw-connect-'));
    const params = buildGatewayConnectParams({
      challengeNonce: 'nonce-123',
      env: { OPENCLAW_STATE_DIR: stateDir },
      token: 'gw-token',
      version: '2.0.3',
    });

    expect(params).toEqual(expect.objectContaining({
      auth: { token: 'gw-token' },
      client: expect.objectContaining({
        displayName: 'ModelHub Bridge',
        id: 'gateway-client',
        mode: 'backend',
        version: '2.0.3',
      }),
      device: expect.objectContaining({
        id: expect.any(String),
        nonce: 'nonce-123',
        publicKey: expect.any(String),
        signature: expect.any(String),
        signedAt: expect.any(Number),
      }),
      role: 'operator',
      scopes: ['operator.admin'],
    }));
  });
});
