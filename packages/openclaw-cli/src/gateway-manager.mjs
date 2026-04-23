import { execSync, spawn } from 'node:child_process';

const HEALTH_TIMEOUT_MS = 3000;
const MODELS_TIMEOUT_MS = 5000;
const WS_TIMEOUT_MS = 10000;
const READY_TIMEOUT_MS = 15000;

function resolvePathBinary() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('where.exe openclaw', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const match = result.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (match) {
        return { args: [], command: match, label: match };
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
    return { args: [], command: String(flags['openclaw-bin']), label: String(flags['openclaw-bin']) };
  }

  if (process.env.OPENCLAW_BIN) {
    return { args: [], command: process.env.OPENCLAW_BIN, label: process.env.OPENCLAW_BIN };
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

async function probeGatewayHttp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return false;
    }
    const data = await res.json().catch(() => null);
    return data?.ok === true || data?.status === 'ok';
  } catch {
    return false;
  }
}

async function probeGatewayModels(port, token) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!res.ok) {
      return false;
    }
    const payload = await res.json().catch(() => null);
    return payload?.object === 'list' && Array.isArray(payload?.data);
  } catch {
    return false;
  }
}

async function probeGatewayWs(port, token) {
  let WebSocketClass = globalThis.WebSocket;
  if (!WebSocketClass) {
    const mod = await import('ws');
    WebSocketClass = mod.WebSocket || mod.default || mod;
  }

  return new Promise((resolve) => {
    const ws = new WebSocketClass(`ws://127.0.0.1:${port}`);
    const clientId = `modelhub-bridge-${Date.now().toString(36)}`;
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
      if (connectSent || ws.readyState !== 1) {
        return;
      }
      connectSent = true;
      const params = {
        auth: token ? { token } : undefined,
        caps: [],
        client: {
          displayName: 'ModelHub Bridge',
          id: 'modelhub-bridge',
          mode: 'operator',
          platform: process.platform,
          version: '2.0.0',
        },
        commands: [],
        device: challengeNonce
          ? {
              id: clientId,
              nonce: challengeNonce,
              signedAt: Date.now(),
            }
          : undefined,
        maxProtocol: 3,
        minProtocol: 3,
        permissions: {},
        role: 'operator',
        scopes: ['operator.approvals', 'operator.read', 'operator.write'],
        userAgent: 'modelhub-bridge/2.0.0',
      };
      ws.send(JSON.stringify({ id: `connect:${clientId}`, method: 'connect', params, type: 'req' }));
    };

    ws.addEventListener('open', () => {
      setTimeout(sendConnect, 50);
    });

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

      if (msg?.type === 'res' && msg?.id?.startsWith('connect:') && msg?.ok === false) {
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

  const modelsOk = await probeGatewayModels(port, token);
  if (!modelsOk) {
    return false;
  }

  return probeGatewayWs(port, token);
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
  const child = spawn(bin.command, [...bin.args, 'gateway', '--port', String(port)], {
    detached: false,
    env: { ...process.env, OPENCLAW_GATEWAY_TOKEN: token },
    stdio: 'pipe',
  });

  child.stdout?.on('data', (chunk) => {
    log.debug('[gateway:stdout]', chunk.toString().trim());
  });
  child.stderr?.on('data', (chunk) => {
    log.debug('[gateway:stderr]', chunk.toString().trim());
  });

  return child;
}

export async function ensureGateway({ bin, port, token, log }) {
  if (await probeGatewayReady(port, token)) {
    log.info(`Gateway: attach em 127.0.0.1:${port} (saudavel)`);
    return { child: null, mode: 'attach' };
  }

  log.info(`Gateway: iniciando processo em 127.0.0.1:${port}...`);
  const child = startGatewayProcess(bin, port, token, log);

  const ready = await waitForGatewayReady(port, token);
  if (!ready) {
    child.kill();
    throw new Error(`Gateway nao ficou saudavel em ${Math.floor(READY_TIMEOUT_MS / 1000)}s na porta ${port}`);
  }

  log.info('Gateway: processo filho saudavel');
  return { child, mode: 'own' };
}
