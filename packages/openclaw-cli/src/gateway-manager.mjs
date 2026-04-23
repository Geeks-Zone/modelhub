import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync, execSync, spawn } from 'node:child_process';

import { buildGatewayConnectParams } from './gateway-auth.mjs';

const HEALTH_TIMEOUT_MS = 3000;
const WS_TIMEOUT_MS = 10000;
const READY_TIMEOUT_MS = 30000;
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.cmd', '.exe', '.bat', '.com'];

export function pickWindowsRunnablePath(candidates) {
  const normalized = Array.isArray(candidates)
    ? candidates.map((candidate) => String(candidate || '').trim()).filter(Boolean)
    : [];

  if (normalized.length === 0) {
    return null;
  }

  for (const extension of WINDOWS_EXECUTABLE_EXTENSIONS) {
    const match = normalized.find((candidate) => candidate.toLowerCase().endsWith(extension));
    if (match) {
      return match;
    }
  }

  return normalized[0];
}

function normalizeWindowsCommand(command) {
  const value = String(command || '').trim();
  if (process.platform !== 'win32' || !value || path.extname(value)) {
    return value;
  }

  const isPathLike = value.includes('\\') || value.includes('/') || path.isAbsolute(value);
  if (isPathLike) {
    const siblingMatch = pickWindowsRunnablePath(
      WINDOWS_EXECUTABLE_EXTENSIONS
        .map((extension) => `${value}${extension}`)
        .filter((candidate) => existsSync(candidate)),
    );
    return siblingMatch ?? value;
  }

  try {
    const result = execFileSync('where.exe', [value], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return pickWindowsRunnablePath(result.split(/\r?\n/)) ?? value;
  } catch {
    return value;
  }
}

export function shouldUseWindowsShell(command) {
  if (process.platform !== 'win32') {
    return false;
  }

  const extension = path.extname(String(command || '').trim()).toLowerCase();
  return extension === '.cmd' || extension === '.bat';
}

export function materializeWindowsOpenClawShim(command, args = []) {
  const normalizedCommand = String(command || '').trim();
  if (!normalizedCommand || path.basename(normalizedCommand).toLowerCase() !== 'openclaw.cmd') {
    return null;
  }

  const binDir = path.dirname(normalizedCommand);
  const scriptPath = path.join(binDir, 'node_modules', 'openclaw', 'openclaw.mjs');
  if (!existsSync(scriptPath)) {
    return null;
  }

  const nodeExePath = path.join(binDir, 'node.exe');
  const nodeCommand = existsSync(nodeExePath) ? nodeExePath : 'node';
  return {
    args: [scriptPath, ...args],
    command: nodeCommand,
    label: `${nodeCommand} ${scriptPath}`,
  };
}

function finalizeResolvedBin(command, args = []) {
  if (process.platform === 'win32') {
    const shim = materializeWindowsOpenClawShim(command, args);
    if (shim) {
      return shim;
    }
  }

  const normalizedCommand = process.platform === 'win32' ? normalizeWindowsCommand(command) : String(command || '').trim();
  return {
    args,
    command: normalizedCommand,
    label: normalizedCommand,
  };
}

function resolvePathBinary() {
  try {
    if (process.platform === 'win32') {
      const result = execFileSync('where.exe', ['openclaw'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const match = pickWindowsRunnablePath(result.split(/\r?\n/));
      if (match) {
        const command = normalizeWindowsCommand(match);
        return { args: [], command, label: command };
      }
      return null;
    }

    const result = execSync('command -v openclaw', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/sh',
    });
    const match = result.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (match) {
      return { args: [], command: match, label: match };
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveOpenClawBin(flags) {
  if (flags['openclaw-bin']) {
    return finalizeResolvedBin(String(flags['openclaw-bin']));
  }

  if (process.env.OPENCLAW_BIN) {
    return finalizeResolvedBin(process.env.OPENCLAW_BIN);
  }

  const pathBinary = resolvePathBinary();
  if (pathBinary) {
    return pathBinary;
  }

  return {
    args: ['-y', 'openclaw@latest'],
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    label: 'npx -y openclaw@latest',
  };
}

export function formatResolvedCommand(bin) {
  return [bin.command, ...(Array.isArray(bin.args) ? bin.args : [])].join(' ');
}

async function requestGatewayProbe(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  if (!res.ok) {
    return false;
  }

  const data = await res.json().catch(() => null);
  if (route === '/ready' || route === '/readyz') {
    return data?.ready === true;
  }

  return data?.ok === true || data?.status === 'ok';
}

async function probeGatewayHttp(port) {
  for (const route of ['/ready', '/readyz', '/health']) {
    try {
      if (await requestGatewayProbe(port, route)) {
        return true;
      }
    } catch {
      // Continue probing the next readiness endpoint.
    }
  }

  return false;
}

async function probeGatewayWs(port, token) {
  let WebSocketClass = globalThis.WebSocket;
  if (!WebSocketClass) {
    const mod = await import('ws');
    WebSocketClass = mod.WebSocket || mod.default || mod;
  }

  return new Promise((resolve) => {
    const ws = new WebSocketClass(`ws://127.0.0.1:${port}`);
    const requestId = `connect:${Date.now().toString(36)}`;
    let challengeNonce = null;
    let settled = false;
    let connectSent = false;

    const cleanup = () => {
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.close();
      }
    };

    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const sendConnect = () => {
      if (connectSent || ws.readyState !== 1 || !challengeNonce) {
        return;
      }
      connectSent = true;
      const params = buildGatewayConnectParams({
        challengeNonce,
        clientDisplayName: 'ModelHub Bridge',
        token,
        version: '2.0.3',
      });
      ws.send(JSON.stringify({ id: requestId, method: 'connect', params, type: 'req' }));
    };

    ws.addEventListener('open', () => {});

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

      if (msg?.type === 'res' && msg?.payload?.type === 'hello-ok' && msg?.ok === true) {
        settle(true);
        return;
      }

      if (msg?.type === 'res' && msg?.id === requestId && msg?.ok === false) {
        settle(false);
      }
    });

    ws.addEventListener('error', () => settle(false));
    ws.addEventListener('close', () => settle(false));

    setTimeout(() => settle(false), WS_TIMEOUT_MS);
  });
}

async function probeGatewayReady(port, token) {
  const httpOk = await probeGatewayHttp(port);
  if (!httpOk) {
    return false;
  }

  return probeGatewayWs(port, token);
}

export function buildGatewayLaunchArgs(port) {
  return ['gateway', 'run', '--port', String(port)];
}

async function waitForGatewayReady(port, token, timeoutMs = READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeGatewayReady(port, token)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function startGatewayProcess(bin, port, token, log) {
  const spawnArgs = [...bin.args, ...buildGatewayLaunchArgs(port)];
  let child;
  try {
    child = spawn(bin.command, spawnArgs, {
      detached: false,
      env: { ...process.env, OPENCLAW_GATEWAY_TOKEN: token },
      shell: shouldUseWindowsShell(bin.command),
      stdio: 'pipe',
    });
  } catch (error) {
    return {
      child: null,
      status: Promise.resolve({
        ok: false,
        reason: `spawn failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
    };
  }

  const status = new Promise((resolve) => {
    child.once('error', (error) => {
      resolve({
        ok: false,
        reason: `spawn failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    });

    child.once('exit', (code, signal) => {
      resolve({
        ok: false,
        reason: signal
          ? `process exited before ficar saudavel (signal=${signal})`
          : `process exited before ficar saudavel (code=${code ?? 'unknown'})`,
      });
    });
  });

  child.stdout?.on('data', (chunk) => {
    log.debug('[gateway:stdout]', chunk.toString().trim());
  });
  child.stderr?.on('data', (chunk) => {
    log.debug('[gateway:stderr]', chunk.toString().trim());
  });

  return { child, status };
}

export async function ensureGateway({ bin, port, token, log }) {
  if (await probeGatewayReady(port, token)) {
    log.info(`Gateway: attach em 127.0.0.1:${port} (saudavel)`);
    return { child: null, mode: 'attach' };
  }

  log.info(`Gateway: iniciando processo em 127.0.0.1:${port}...`);
  const { child, status } = startGatewayProcess(bin, port, token, log);

  const outcome = await Promise.race([
    waitForGatewayReady(port, token).then((ready) => ({ kind: 'ready', ready })),
    status.then((result) => ({ kind: 'status', result })),
  ]);

  if (outcome.kind === 'status') {
    throw new Error(`Gateway nao iniciou: ${outcome.result.reason}`);
  }

  const ready = outcome.ready;
  if (!ready) {
    child?.kill();
    throw new Error(`Gateway nao ficou saudavel em ${Math.floor(READY_TIMEOUT_MS / 1000)}s na porta ${port}`);
  }

  log.info('Gateway: processo filho saudavel');
  return { child, mode: 'own' };
}
