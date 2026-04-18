import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Preserve original env
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

describe("crypto helpers", () => {
  beforeEach(() => {
    // Valid 64-char hex key for tests
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  // ─── generateApiKey ────────────────────────────────────────────────

  describe("generateApiKey", () => {
    it("gera chave com prefixo sk-", async () => {
      const { generateApiKey } = await import("../lib/crypto");
      const { raw, hash, prefix } = generateApiKey();

      expect(raw.startsWith("sk-")).toBe(true);
      expect(prefix.startsWith("sk-")).toBe(true);
      expect(hash).toHaveLength(64); // SHA-256 hex
    });

    it("gera chaves unicas a cada chamada", async () => {
      const { generateApiKey } = await import("../lib/crypto");
      const a = generateApiKey();
      const b = generateApiKey();

      expect(a.raw).not.toBe(b.raw);
      expect(a.hash).not.toBe(b.hash);
    });

    it("hash é consistente com hashApiKey", async () => {
      const { generateApiKey, hashApiKey } = await import("../lib/crypto");
      const { raw, hash } = generateApiKey();

      expect(hash).toBe(hashApiKey(raw));
    });

    it("prefix tem exatamente 11 caracteres (sk- + 8)", async () => {
      const { generateApiKey } = await import("../lib/crypto");
      const { prefix } = generateApiKey();

      expect(prefix).toHaveLength(11);
    });
  });

  // ─── hashApiKey ────────────────────────────────────────────────────

  describe("hashApiKey", () => {
    it("retorna hash SHA-256 em hex", async () => {
      const { hashApiKey } = await import("../lib/crypto");
      const hash = hashApiKey("sk-test-key");

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("é determinístico para a mesma entrada", async () => {
      const { hashApiKey } = await import("../lib/crypto");

      expect(hashApiKey("sk-abc")).toBe(hashApiKey("sk-abc"));
    });

    it("produz hashes diferentes para entradas diferentes", async () => {
      const { hashApiKey } = await import("../lib/crypto");

      expect(hashApiKey("sk-abc")).not.toBe(hashApiKey("sk-xyz"));
    });
  });

  // ─── encryptCredential / decryptCredential ─────────────────────────

  describe("encryptCredential / decryptCredential", () => {
    it("encripta e decripta corretamente", async () => {
      const { encryptCredential, decryptCredential } = await import("../lib/crypto");
      const plaintext = "super-secret-api-key-12345";

      const stored = encryptCredential(plaintext);
      const recovered = decryptCredential(stored);

      expect(recovered).toBe(plaintext);
    });

    it("formato armazenado é iv:ciphertext:tag", async () => {
      const { encryptCredential } = await import("../lib/crypto");
      const stored = encryptCredential("test");
      const parts = stored.split(":");

      expect(parts).toHaveLength(3);
      // IV = 12 bytes = 24 hex chars
      expect(parts[0]).toHaveLength(24);
      // tag = 16 bytes = 32 hex chars
      expect(parts[2]).toHaveLength(32);
    });

    it("gera ciphertexts diferentes para o mesmo plaintext (IV aleatório)", async () => {
      const { encryptCredential } = await import("../lib/crypto");
      const a = encryptCredential("same-value");
      const b = encryptCredential("same-value");

      expect(a).not.toBe(b);
    });

    it("encripta strings vazias", async () => {
      const { encryptCredential, decryptCredential } = await import("../lib/crypto");
      const stored = encryptCredential("");

      expect(decryptCredential(stored)).toBe("");
    });

    it("encripta strings com caracteres especiais e unicode", async () => {
      const { encryptCredential, decryptCredential } = await import("../lib/crypto");
      const plaintext = "chave-com-émojis-🔑-e-特殊文字";

      expect(decryptCredential(encryptCredential(plaintext))).toBe(plaintext);
    });

    it("lança erro para formato inválido (partes faltando)", async () => {
      const { decryptCredential } = await import("../lib/crypto");

      expect(() => decryptCredential("invalido")).toThrow("Invalid encrypted credential format");
      expect(() => decryptCredential("a:b")).toThrow("Invalid encrypted credential format");
    });

    it("lança erro quando ENCRYPTION_KEY não está definida", async () => {
      delete process.env.ENCRYPTION_KEY;
      // Re-import to get fresh module without cached key
      vi.resetModules();
      const { encryptCredential } = await import("../lib/crypto");

      expect(() => encryptCredential("test")).toThrow("ENCRYPTION_KEY env var is required");
    });

    it("lança erro quando ENCRYPTION_KEY tem tamanho inválido", async () => {
      process.env.ENCRYPTION_KEY = "tooshort";
      vi.resetModules();
      const { encryptCredential } = await import("../lib/crypto");

      expect(() => encryptCredential("test")).toThrow("ENCRYPTION_KEY must be exactly 32 bytes");
    });

    it("falha ao decriptar com tag adulterada (autenticação GCM)", async () => {
      const { encryptCredential, decryptCredential } = await import("../lib/crypto");
      const stored = encryptCredential("sensitive-data");
      const [iv, cipher, tag] = stored.split(":");
      // Flip last byte of tag
      const tamperedTag = tag!.slice(0, -2) + (tag!.slice(-2) === "ff" ? "00" : "ff");
      const tampered = `${iv}:${cipher}:${tamperedTag}`;

      expect(() => decryptCredential(tampered)).toThrow();
    });
  });
});
