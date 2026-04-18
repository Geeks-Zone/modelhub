import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────

const mockPrismaClient = vi.fn();
const mockPool = vi.fn();
const mockAdapter = vi.fn();
const mockEnsureRuntimeEnvValidated = vi.fn();

vi.mock("pg", () => ({
  Pool: mockPool,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: mockAdapter,
}));

vi.mock("../../generated/prisma/client.ts", () => ({
  PrismaClient: mockPrismaClient,
}));

vi.mock("../env", () => ({
  ensureRuntimeEnvValidated: mockEnsureRuntimeEnvValidated,
}));

// ─── Tests ─────────────────────────────────────────────────────────

describe("db singleton", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Clear the global singleton between tests
    const g = globalThis as { __prisma?: unknown };
    delete g.__prisma;

    process.env.DATABASE_URL = "postgresql://user:pass@host-pooler.neon.tech/db?sslmode=require";
    process.env.NODE_ENV = "test";

    const fakeClient = { $connect: vi.fn(), $disconnect: vi.fn() };
    mockPrismaClient.mockReturnValue(fakeClient);
    mockPool.mockReturnValue({ end: vi.fn() });
    mockAdapter.mockReturnValue({});
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.NODE_ENV = originalNodeEnv;
    const g = globalThis as { __prisma?: unknown };
    delete g.__prisma;
  });

  it("cria o PrismaClient com o adapter correto", async () => {
    await import("../lib/db");

    expect(mockEnsureRuntimeEnvValidated).toHaveBeenCalled();
    expect(mockPool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: process.env.DATABASE_URL,
        ssl: true,
      }),
    );
    expect(mockAdapter).toHaveBeenCalled();
    expect(mockPrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({ adapter: expect.anything() }),
    );
  });

  it("lança erro quando DATABASE_URL não está definida", async () => {
    delete process.env.DATABASE_URL;

    await expect(import("../lib/db")).rejects.toThrow("DATABASE_URL");
  });

  it("reutiliza o singleton em ambiente não-produção", async () => {
    process.env.NODE_ENV = "development";
    const g = globalThis as { __prisma?: unknown };

    const { prisma: first } = await import("../lib/db");
    vi.resetModules();
    // Simulate second import — singleton should be reused via globalThis
    g.__prisma = first;
    const { prisma: second } = await import("../lib/db");

    expect(second).toBe(first);
    // PrismaClient should only have been constructed once
    expect(mockPrismaClient).toHaveBeenCalledTimes(1);
  });

  it("não armazena singleton em produção", async () => {
    process.env.NODE_ENV = "production";
    const g = globalThis as { __prisma?: unknown };

    await import("../lib/db");

    expect(g.__prisma).toBeUndefined();
  });
});
