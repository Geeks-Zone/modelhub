import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildGatewayLaunchArgs,
  materializeWindowsOpenClawShim,
  pickWindowsRunnablePath,
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
