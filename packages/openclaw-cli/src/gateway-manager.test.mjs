import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildGatewayLaunchArgs,
  isGatewayReadyLogLine,
  materializeWindowsOpenClawShim,
  pickWindowsRunnablePath,
  shouldForceRestartGateway,
  shouldUseWindowsShell,
} from './gateway-manager.mjs';

describe('gateway-manager helpers', () => {
  it('prefers .cmd shims over extensionless Windows npm shims', () => {
    expect(pickWindowsRunnablePath([
      'C:\\nvm4w\\nodejs\\openclaw',
      'C:\\nvm4w\\nodejs\\openclaw.cmd',
    ])).toBe('C:\\nvm4w\\nodejs\\openclaw.cmd');
  });

  it('falls back to the first candidate when no executable extension is present', () => {
    expect(pickWindowsRunnablePath([
      'C:\\tools\\openclaw',
      'C:\\tools\\openclaw.ps1',
    ])).toBe('C:\\tools\\openclaw');
  });

  it('marks .cmd files as requiring a Windows shell', () => {
    expect(shouldUseWindowsShell('C:\\nvm4w\\nodejs\\openclaw.cmd')).toBe(process.platform === 'win32');
  });

  it('starts the gateway with the explicit run subcommand', () => {
    expect(buildGatewayLaunchArgs(18789)).toEqual(['gateway', 'run', '--port', '18789']);
    expect(buildGatewayLaunchArgs(18789, { force: true })).toEqual(['gateway', 'run', '--port', '18789', '--force']);
  });

  it('recognizes the gateway ready log line', () => {
    expect(isGatewayReadyLogLine('2026-04-24T09:35:50.046-03:00 [gateway] ready (5 plugins: acpx; 13.0s)')).toBe(true);
    expect(isGatewayReadyLogLine('2026-04-24T09:35:37.015-03:00 [gateway] starting...')).toBe(false);
  });

  it('recognizes startup failures that should trigger a forced restart', () => {
    expect(shouldForceRestartGateway('Gateway nao iniciou: process exited before ficar saudavel (code=1); detalhe: Port 18789 is already in use.')).toBe(true);
    expect(shouldForceRestartGateway('Gateway existente em 127.0.0.1:18789 respondeu ao /ready, mas rejeitou o token configurado.')).toBe(true);
    expect(shouldForceRestartGateway('Gateway nao ficou saudavel em 60s na porta 18789')).toBe(false);
  });

  it('materializes the Windows npm shim into a direct node invocation', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'openclaw-shim-'));
    const shimPath = path.join(tempDir, 'openclaw.cmd');
    const nodeExePath = path.join(tempDir, 'node.exe');
    const scriptPath = path.join(tempDir, 'node_modules', 'openclaw', 'openclaw.mjs');
    mkdirSync(path.dirname(scriptPath), { recursive: true });
    writeFileSync(shimPath, '@echo off\n');
    writeFileSync(nodeExePath, '');
    writeFileSync(scriptPath, '');

    expect(materializeWindowsOpenClawShim(shimPath, ['gateway', 'run'])).toEqual({
      args: [scriptPath, 'gateway', 'run'],
      command: nodeExePath,
      label: `${nodeExePath} ${scriptPath}`,
    });
  });
});
