import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { homedir } from 'node:os';

const DEFAULT_CLIENT_ID = 'gateway-client';
const DEFAULT_CLIENT_MODE = 'backend';
const DEFAULT_ROLE = 'operator';
const DEFAULT_SCOPES = ['operator.admin'];
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function filterUndefinedEntries(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function base64UrlEncode(buffer) {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function normalizeTrimmedMetadata(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : '';
}

export function normalizeDeviceMetadataForAuth(value) {
  return normalizeTrimmedMetadata(value).replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

export function normalizeGatewayScopes(scopes) {
  const normalized = Array.isArray(scopes)
    ? [...new Set(scopes.map((scope) => String(scope || '').trim()).filter(Boolean))]
    : [];

  if (normalized.includes('operator.admin')) {
    return ['operator.admin'];
  }

  if (normalized.includes('operator.write') && !normalized.includes('operator.read')) {
    normalized.push('operator.read');
  }

  return normalized.length > 0 ? normalized : [...DEFAULT_SCOPES];
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = createPublicKey(publicKeyPem).export({
    format: 'der',
    type: 'spki',
  });

  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32
    && Buffer.from(spki.subarray(0, ED25519_SPKI_PREFIX.length)).equals(ED25519_SPKI_PREFIX)
  ) {
    return Buffer.from(spki.subarray(ED25519_SPKI_PREFIX.length));
  }

  return Buffer.from(spki);
}

function fingerprintPublicKey(publicKeyPem) {
  return createHash('sha256').update(derivePublicKeyRaw(publicKeyPem)).digest('hex');
}

function generateDeviceIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({
    format: 'pem',
    type: 'spki',
  });
  const privateKeyPem = privateKey.export({
    format: 'pem',
    type: 'pkcs8',
  });

  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    privateKeyPem,
    publicKeyPem,
  };
}

export function resolveOpenClawStateDir(env = process.env) {
  if (env.OPENCLAW_CONFIG_PATH) {
    return path.dirname(path.resolve(env.OPENCLAW_CONFIG_PATH));
  }

  if (env.OPENCLAW_STATE_DIR) {
    return path.resolve(env.OPENCLAW_STATE_DIR);
  }

  return path.join(homedir(), '.openclaw');
}

export function resolveOpenClawDeviceIdentityPath(env = process.env) {
  return path.join(resolveOpenClawStateDir(env), 'identity', 'device.json');
}

export function loadOrCreateDeviceIdentity({ env = process.env, filePath = resolveOpenClawDeviceIdentityPath(env) } = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (
        parsed?.version === 1
        && typeof parsed.deviceId === 'string'
        && typeof parsed.publicKeyPem === 'string'
        && typeof parsed.privateKeyPem === 'string'
      ) {
        const derivedDeviceId = fingerprintPublicKey(parsed.publicKeyPem);
        if (derivedDeviceId === parsed.deviceId) {
          return {
            deviceId: parsed.deviceId,
            privateKeyPem: parsed.privateKeyPem,
            publicKeyPem: parsed.publicKeyPem,
          };
        }

        const updated = {
          ...parsed,
          deviceId: derivedDeviceId,
        };
        fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
        return {
          deviceId: derivedDeviceId,
          privateKeyPem: parsed.privateKeyPem,
          publicKeyPem: parsed.publicKeyPem,
        };
      }
    }
  } catch {
    // Fall through and recreate the identity file.
  }

  const identity = generateDeviceIdentity();
  const stored = {
    createdAtMs: Date.now(),
    deviceId: identity.deviceId,
    privateKeyPem: identity.privateKeyPem,
    publicKeyPem: identity.publicKeyPem,
    version: 1,
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });

  return identity;
}

export function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

export function signDeviceAuthPayload(privateKeyPem, payload) {
  return base64UrlEncode(sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(privateKeyPem)));
}

export function buildDeviceAuthPayloadV3({
  clientId = DEFAULT_CLIENT_ID,
  clientMode = DEFAULT_CLIENT_MODE,
  deviceFamily = '',
  deviceId,
  nonce,
  platform = process.platform,
  role = DEFAULT_ROLE,
  scopes = DEFAULT_SCOPES,
  signedAtMs,
  token,
}) {
  return [
    'v3',
    deviceId,
    clientId,
    clientMode,
    role,
    normalizeGatewayScopes(scopes).join(','),
    String(signedAtMs),
    token ?? '',
    nonce ?? '',
    normalizeDeviceMetadataForAuth(platform),
    normalizeDeviceMetadataForAuth(deviceFamily),
  ].join('|');
}

export function buildGatewayConnectParams({
  caps = [],
  challengeNonce,
  clientDisplayName = 'ModelHub Bridge',
  clientId = DEFAULT_CLIENT_ID,
  clientMode = DEFAULT_CLIENT_MODE,
  commands,
  deviceFamily = '',
  env = process.env,
  permissions,
  platform = process.platform,
  role = DEFAULT_ROLE,
  scopes = DEFAULT_SCOPES,
  token,
  userAgent,
  version,
}) {
  const identity = loadOrCreateDeviceIdentity({ env });
  const normalizedScopes = normalizeGatewayScopes(scopes);
  const normalizedPlatform = normalizeDeviceMetadataForAuth(platform);
  const normalizedDeviceFamily = normalizeDeviceMetadataForAuth(deviceFamily);
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayloadV3({
    clientId,
    clientMode,
    deviceFamily: normalizedDeviceFamily,
    deviceId: identity.deviceId,
    nonce: challengeNonce,
    platform: normalizedPlatform,
    role,
    scopes: normalizedScopes,
    signedAtMs,
    token,
  });

  return filterUndefinedEntries({
    auth: token ? { token } : undefined,
    caps: Array.isArray(caps) ? caps : [],
    client: filterUndefinedEntries({
      deviceFamily: normalizedDeviceFamily || undefined,
      displayName: clientDisplayName,
      id: clientId,
      mode: clientMode,
      platform: normalizedPlatform || undefined,
      version,
    }),
    commands: Array.isArray(commands) ? commands : undefined,
    device: {
      id: identity.deviceId,
      nonce: challengeNonce,
      publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      signature: signDeviceAuthPayload(identity.privateKeyPem, payload),
      signedAt: signedAtMs,
    },
    maxProtocol: 3,
    minProtocol: 3,
    permissions: permissions && typeof permissions === 'object' ? permissions : undefined,
    role,
    scopes: normalizedScopes,
    userAgent: userAgent || `modelhub-bridge/${version}`,
  });
}
