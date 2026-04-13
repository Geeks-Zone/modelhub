import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
  usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));

const originalRequireAuth = process.env.REQUIRE_AUTH;
const liveIt = process.env.RUN_DUCKAI_LIVE === "1" ? it : it.skip;

type DuckAiModel = {
  id: string;
  name: string;
};

type ModelOutcome = "ok" | "failed" | "blocked";

type AttemptResult = {
  attempt: number;
  browserFallbackUsed?: boolean;
  challengeJsdomAttempts?: number;
  detail?: string;
  durationMs: number;
  internalChatAttempts?: number;
  ok: boolean;
  preview?: string;
  retryClass?: string;
  status?: number;
  error?: string;
};

type ModelCheckResult = {
  id: string;
  name: string;
  note?: string;
  outcome: ModelOutcome;
  attempts: AttemptResult[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

function sortModelsForExecution(models: DuckAiModel[]): DuckAiModel[] {
  const baselineModelId = process.env.DUCKAI_BASELINE_MODEL ?? "gpt-4o-mini";
  const baselineIndex = models.findIndex((model) => model.id === baselineModelId);

  if (baselineIndex <= 0) {
    return models;
  }

  const ordered = [...models];
  const [baseline] = ordered.splice(baselineIndex, 1);
  ordered.unshift(baseline);
  return ordered;
}

function filterModelsForExecution(models: DuckAiModel[]): DuckAiModel[] {
  const onlyModels = process.env.DUCKAI_ONLY_MODELS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!onlyModels?.length) {
    return models;
  }

  const allowedIds = new Set(onlyModels);
  return models.filter((model) => allowedIds.has(model.id));
}

function classifyAttempt(attempt: AttemptResult): { globalBlockReason?: string; outcome: ModelOutcome } {
  if (attempt.ok) {
    return { outcome: "ok" };
  }

  const detail = `${attempt.detail ?? ""} ${attempt.error ?? ""}`;

  if (
    attempt.status === 429 ||
    detail.includes("ERR_RATE_LIMIT") ||
    detail.includes("Failed to get VQD status: 429")
  ) {
    return { globalBlockReason: "rate_limit", outcome: "blocked" };
  }

  if (
    detail.includes("ERR_BN_LIMIT") ||
    attempt.retryClass === "bn_limit"
  ) {
    return { globalBlockReason: "bn_limit", outcome: "blocked" };
  }

  if (
    attempt.status === 418 ||
    detail.includes("ERR_CHALLENGE") ||
    detail.includes("Challenge execution failed") ||
    detail.includes("contentDocument")
  ) {
    return { globalBlockReason: "challenge", outcome: "blocked" };
  }

  return { outcome: "failed" };
}

function resolveModelOutcome(attempts: AttemptResult[]): ModelOutcome {
  const outcomes = attempts.map((attempt) => classifyAttempt(attempt).outcome);
  if (outcomes.includes("ok")) {
    return "ok";
  }
  if (outcomes.includes("failed")) {
    return "failed";
  }
  return "blocked";
}

function formatConsoleArg(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function captureConsoleError<T>(callback: () => T | Promise<T>) {
  const captured: string[] = [];
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;

  const capture = (...args: unknown[]) => {
    captured.push(args.map((arg) => formatConsoleArg(arg)).join(" "));
  };

  console.error = (...args: unknown[]) => {
    capture(...args);
    originalConsoleError(...args);
  };
  console.log = (...args: unknown[]) => {
    capture(...args);
    originalConsoleLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    capture(...args);
    originalConsoleWarn(...args);
  };

  try {
    const result = await Promise.resolve(callback());
    return { captured, result };
  } finally {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }
}

function parseDuckAiStructuredLogs(captured: string[]) {
  let browserFallbackUsed = false;
  let challengeJsdomAttempts: number | undefined;
  let internalChatAttempts = 0;
  let retryClass: string | undefined;

  for (const line of captured) {
    const match = line.match(/^\[Duck\.ai\]\[(chat|challenge)\]\s+(.+)$/);
    if (!match) {
      continue;
    }

    try {
      const payload = JSON.parse(match[2]) as {
        attempt?: unknown;
        browserFallbackUsed?: unknown;
        jsdomAttempts?: unknown;
        retryClass?: unknown;
      };

      if (match[1] === "chat" && typeof payload.attempt === "number") {
        internalChatAttempts = Math.max(internalChatAttempts, payload.attempt);
      }
      if (typeof payload.retryClass === "string") {
        retryClass = payload.retryClass;
      }
      if (payload.browserFallbackUsed === true) {
        browserFallbackUsed = true;
      }
      if (typeof payload.jsdomAttempts === "number") {
        challengeJsdomAttempts = Math.max(challengeJsdomAttempts ?? 0, payload.jsdomAttempts);
      }
    } catch {
      // Ignore malformed structured logs in the report parser.
    }
  }

  return {
    browserFallbackUsed,
    challengeJsdomAttempts,
    internalChatAttempts: internalChatAttempts > 0 ? internalChatAttempts : undefined,
    retryClass,
  };
}

function formatSummary(results: ModelCheckResult[]): string {
  const lines = results.map((result) => {
    const status = result.outcome.toUpperCase();
    const lastAttempt = result.attempts[result.attempts.length - 1];
    const detail = result.outcome === "ok"
      ? `preview="${lastAttempt?.preview ?? ""}"`
      : result.note
        ? `note="${result.note}"`
        : `error="${lastAttempt?.error ?? `HTTP ${lastAttempt?.status ?? "unknown"}`}"`;

    return `- ${status} ${result.id} (${result.name}) after ${result.attempts.length} tentativa(s); ${detail}`;
  });

  return ["Duck.ai live matrix:", ...lines].join("\n");
}

async function writeReport(results: ModelCheckResult[]) {
  const reportPath = path.resolve(process.cwd(), "generated", "duckai-live-report.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        prompt: process.env.DUCKAI_TEST_PROMPT ?? "Responda apenas com OK.",
        results,
        runAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  return reportPath;
}

describe("Duck.ai live model matrix", () => {
  beforeAll(() => {
    process.env.REQUIRE_AUTH = "false";
  });

  afterAll(() => {
    process.env.REQUIRE_AUTH = originalRequireAuth;
  });

  liveIt(
    "lists models dynamically and tries a short chat with each one",
    async () => {
      const { duckAiApp, fetchDuckAiModels } = await import("../providers/duckai");
      const { parseChatStream } = await import("@/lib/chat-stream");

      const models = filterModelsForExecution(sortModelsForExecution((await fetchDuckAiModels()) as DuckAiModel[]));
      expect(models.length).toBeGreaterThan(0);

      const results: ModelCheckResult[] = [];
      const maxAttempts = Number(process.env.DUCKAI_MODEL_RETRIES ?? "3");
      const attemptDelayMs = Number(process.env.DUCKAI_ATTEMPT_DELAY_MS ?? "750");
      const betweenModelsDelayMs = Number(process.env.DUCKAI_BETWEEN_MODELS_DELAY_MS ?? "500");
      const rateLimitBackoffMs = Number(process.env.DUCKAI_RATE_LIMIT_BACKOFF_MS ?? "65000");
      const prompt = process.env.DUCKAI_TEST_PROMPT ?? "Responda apenas com OK.";
      let globalBlockReason: string | null = null;

      for (const model of models) {
        if (globalBlockReason) {
          const result: ModelCheckResult = {
            attempts: [],
            id: model.id,
            name: model.name,
            note: `Nao executado porque a Duck.ai bloqueou a rodada anterior por ${globalBlockReason}.`,
            outcome: "blocked",
          };
          results.push(result);
          console.log(`[duckai-live] BLOCKED ${model.id} (${model.name}) due to ${globalBlockReason}`);
          continue;
        }

        const attempts: AttemptResult[] = [];

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const startedAt = performance.now();

          try {
            const { captured, result: response } = await captureConsoleError(() =>
              duckAiApp.request("/duckai/api/chat", {
                body: JSON.stringify({
                  modelId: model.id,
                  messages: [{ content: prompt, role: "user" }],
                }),
                headers: {
                  "content-type": "application/json",
                },
                method: "POST",
              }),
            );

            const durationMs = Math.round(performance.now() - startedAt);
            const telemetry = parseDuckAiStructuredLogs(captured);
            const detail = captured.at(-1) ? truncate(captured.at(-1) ?? "", 500) : undefined;

            if (!response.ok) {
              const errorBody = truncate(await response.text());
              attempts.push({
                attempt,
                browserFallbackUsed: telemetry.browserFallbackUsed,
                challengeJsdomAttempts: telemetry.challengeJsdomAttempts,
                detail,
                durationMs,
                error: errorBody || `HTTP ${response.status}`,
                internalChatAttempts: telemetry.internalChatAttempts,
                ok: false,
                retryClass: telemetry.retryClass,
                status: response.status,
              });
            } else {
              const parsed = await parseChatStream(response, {});
              const text = truncate(parsed.text);
              attempts.push({
                attempt,
                browserFallbackUsed: telemetry.browserFallbackUsed,
                challengeJsdomAttempts: telemetry.challengeJsdomAttempts,
                detail,
                durationMs,
                error: parsed.errorMessage ? truncate(parsed.errorMessage) : undefined,
                internalChatAttempts: telemetry.internalChatAttempts ?? 1,
                ok: text.length > 0 && !parsed.errorMessage,
                preview: text,
                retryClass: telemetry.retryClass,
              });

              if (text.length > 0 && !parsed.errorMessage) {
                break;
              }
            }
          } catch (error) {
            const durationMs = Math.round(performance.now() - startedAt);
            attempts.push({
              attempt,
              durationMs,
              error: truncate(error instanceof Error ? error.message : String(error)),
              ok: false,
            });
          }

          const classification = classifyAttempt(attempts[attempts.length - 1]);
          if (classification.globalBlockReason) {
            globalBlockReason = classification.globalBlockReason;
          }

          if (classification.outcome !== "failed") {
            break;
          }

          if (attempt < maxAttempts) {
            const lastAttempt = attempts[attempts.length - 1];
            const delayMs = lastAttempt?.status === 429 ? rateLimitBackoffMs : attemptDelayMs;
            await sleep(delayMs);
          }
        }

        const result: ModelCheckResult = {
          attempts,
          id: model.id,
          name: model.name,
          note:
            resolveModelOutcome(attempts) === "blocked" && globalBlockReason
              ? `Bloqueado pela Duck.ai durante o fluxo (${globalBlockReason}).`
              : undefined,
          outcome: resolveModelOutcome(attempts),
        };

        results.push(result);

        const lastAttempt = attempts[attempts.length - 1];
        console.log(
          `[duckai-live] ${result.outcome.toUpperCase()} ${model.id} (${model.name}) in ${lastAttempt?.durationMs ?? 0}ms`,
        );

        if (result.outcome !== "ok" && betweenModelsDelayMs > 0) {
          await sleep(betweenModelsDelayMs);
        }
      }

      const reportPath = await writeReport(results);
      console.log(`[duckai-live] report saved to ${reportPath}`);

      const failures = results.filter((result) => result.outcome === "failed");
      const successes = results.filter((result) => result.outcome === "ok");
      if (failures.length > 0 || successes.length === 0) {
        throw new Error(formatSummary(results));
      }
    },
    300_000,
  );
});
