/**
 * Módulo de criptografia para proteção de credenciais e API keys.
 *
 * - Credenciais de provedores: AES-256-GCM (IV 12 bytes, tag 16 bytes)
 * - API Keys: SHA-256 para armazenamento + comparação em tempo constante
 */

import "../env";

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

// ─── Configurações ──────────────────────────────────────────────────

const AES_ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/** Chave mestra para encriptar credenciais. DEVE ser definida em produção. */
function getEncryptionKey(): Buffer {
  const raw = process.env["ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error("ENCRYPTION_KEY env var is required for credential encryption");
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)");
  }
  return buf;
}

// ─── Credenciais de provedores (AES-256-GCM) ───────────────────────

/** Encripta um valor. Retorna `iv:ciphertext:tag` em hex */
export function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${encrypted}:${tag}`;
}

/** Decripta um valor armazenado no formato `iv:ciphertext:tag` */
export function decryptCredential(stored: string): string {
  const key = getEncryptionKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credential format");
  }
  const [ivHex, cipherHex, tagHex] = parts;
  if (!ivHex || cipherHex === undefined || !tagHex) {
    throw new Error("Invalid encrypted credential format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  let decrypted = decipher.update(cipherHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ─── API Keys ──────────────────────────────────────────────────────

/** Gera uma API Key raw e retorna { raw, hash, prefix } */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `sk-${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 11); // "sk-" + 8 chars
  return { raw, hash, prefix };
}

/** Faz hash SHA-256 de uma API key para lookup */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
