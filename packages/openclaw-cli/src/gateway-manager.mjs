import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync, execSync, spawn } from 'node:child_process';

import { GatewayClient } from './gateway-client.mjs';

const HEALTH_TIMEOUT_MS = 3000;
const WS_TIMEOUT_MS = 10000;
const READY_TIMEOUT_MS = 60000;
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.cmd', '.exe', '.bat', '.com'];
const PROCESS_LOG_LINE_LIMIT = 8;

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

function appendProcessLogLines(target, chunk) {
  const lines = String(chunk || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return;
  }

  target.push(...lines);
  if (target.length > PROCESS_LOG_LINE_LIMIT) {
    target.splice(0, target.length - PROCESS_LOG_LINE_LIMIT);
  }
}

function buildProcessFailureReason(baseReason, stderrLines, stdoutLines) {
  const detail = stderrLines.at(-1) || stdoutLines.at(-1);
  return detail ? `${baseReason}; detalhe: ${detail}` : baseReason;
}

export function isGatewayReadyLogLine(line) {
  const value = String(line || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  return value.includes('[gateway] ready')
    || /\bready \(\d+(\.\d+)?s\)/i.test(value);
}

export function shouldForceRestartGateway(reason) {
  const value = String(reason || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  return value.includes('already running')
    || value.includes('already in use')
    || value.includes('lock timeout')
    || value.includes('eaddrinuse')
    || value.includes('port ')
    || value.includes('rejeitou o token')
    || value.includes('respondeu ao /ready');
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
  const client = new GatewayClient(`http://127.0.0.1:${port}`, token, {
    debug() {},
    error() {},
    info() {},
    warn() {},
  });

  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gateway WS probe timeout')), WS_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    client.dispose();
  }
}

async function probeGatewayAttachable(port, token) {
  const wsOk = await probeGatewayWs(port, token);
  if (wsOk) {
    return { conflict: false, ok: true };
  }

  const httpOk = await probeGatewayHttp(port);
  if (httpOk) {
    return { conflict: true, ok: false };
  }

  return { conflict: false, ok: false };
}

async function probeGatewayBootReady(port, token) {
  const httpOk = await probeGatewayHttp(port);
  if (httpOk) {
    return true;
  }

  return probeGatewayWs(port, token);
}

export function buildGatewayLaunchArgs(port, { force = false } = {}) {
  const args = ['gateway', 'run', '--port', String(port)];
  if (force) {
    args.push('--force');
  }
  return args;
}

async function waitForGatewayReady(port, token, timeoutMs = READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeGatewayBootReady(port, token)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function notifyProcessLogLine(onLogLine, source, line) {
  if (!onLogLine) {
    return;
  }
  try {
    onLogLine({ line, source });
  } catch {
    // Log forwarding is best-effort and must not affect the gateway process.
  }
}

function startGatewayProcess(bin, port, token, log, { force = false, onLogLine } = {}) {
  const spawnArgs = [...bin.args, ...buildGatewayLaunchArgs(port, { force })];
  const stderrLines = [];
  const stdoutLines = [];
  let readyResolve = null;
  const readySignal = new Promise((resolve) => {
    readyResolve = resolve;
  });
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
      readySignal: Promise.resolve(false),
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
        reason: buildProcessFailureReason(
          signal
            ? `process exited before ficar saudavel (signal=${signal})`
            : `process exited before ficar saudavel (code=${code ?? 'unknown'})`,
          stderrLines,
          stdoutLines,
        ),
      });
    });
  });

  child.stdout?.on('data', (chunk) => {
    appendProcessLogLines(stdoutLines, chunk);
    const lines = chunk.toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      notifyProcessLogLine(onLogLine, 'stdout', line);
      if (isGatewayReadyLogLine(line)) {
        readyResolve?.(true);
      }
    }
    log.debug('[gateway:stdout]', chunk.toString().trim());
  });
  child.stderr?.on('data', (chunk) => {
    appendProcessLogLines(stderrLines, chunk);
    const lines = chunk.toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      notifyProcessLogLine(onLogLine, 'stderr', line);
    }
    log.debug('[gateway:stderr]', chunk.toString().trim());
  });

  return { child, readySignal, status };
}

async function bootGatewayProcess({ bin, force = false, log, onLogLine, port, token }) {
  log.info(
    force
      ? `Gateway: tentando reinicio forcado em 127.0.0.1:${port}...`
      : `Gateway: iniciando processo em 127.0.0.1:${port}...`,
  );

  const { child, readySignal, status } = startGatewayProcess(bin, port, token, log, { force, onLogLine });

  const outcome = await Promise.race([
    waitForGatewayReady(port, token).then((ready) => ({ kind: 'ready', ready })),
    readySignal.then(() => ({ kind: 'ready-signal', ready: true })),
    status.then((result) => ({ kind: 'status', result })),
  ]);

  if (outcome.kind === 'status') {
    throw new Error(`Gateway nao iniciou: ${outcome.result.reason}`);
  }

  if (!outcome.ready) {
    if (await probeGatewayBootReady(port, token)) {
      log.info('Gateway: processo filho saudavel (confirmado apos timeout inicial)');
      return { child, mode: 'own' };
    }
    child?.kill();
    throw new Error(`Gateway nao ficou saudavel em ${Math.floor(READY_TIMEOUT_MS / 1000)}s na porta ${port}`);
  }

  log.info('Gateway: processo filho saudavel');
  return { child, mode: 'own' };
}

export async function ensureGateway({ bin, port, token, log, onLogLine }) {
  const attachProbe = await probeGatewayAttachable(port, token);
  if (attachProbe.ok) {
    log.info(`Gateway: attach em 127.0.0.1:${port} (saudavel)`);
    return { child: null, mode: 'attach' };
  }

  if (attachProbe.conflict) {
    log.warn(
      `Gateway existente em 127.0.0.1:${port} respondeu ao /ready, mas rejeitou o token configurado. Tentando reinicio forcado...`,
    );
    return bootGatewayProcess({ bin, force: true, log, onLogLine, port, token });
  }

  try {
    return await bootGatewayProcess({ bin, force: false, log, onLogLine, port, token });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (shouldForceRestartGateway(message)) {
      log.warn(`Gateway: primeira tentativa falhou (${message}). Tentando reinicio forcado...`);
      return bootGatewayProcess({ bin, force: true, log, onLogLine, port, token });
    }
    throw error;
  }
}
