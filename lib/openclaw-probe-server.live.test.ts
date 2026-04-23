/**
 * Teste opcional contra um gateway OpenClaw real (mesma máquina ou URL configurada).
 *
 * Não corre na CI por defeito. Para executar:
 *
 *   set OPENCLAW_GATEWAY_TOKEN=seu_token
 *   set RUN_OPENCLAW_GATEWAY_LIVE=1
 *   pnpm vitest run lib/openclaw-probe-server.live.test.ts
 *
 * Opcional: OPENCLAW_PROBE_URL (default http://127.0.0.1:18789)
 */
import { describe, expect, it } from "vitest";

import { runOpenClawProbeFromServer } from "@/lib/openclaw-probe-server";

const liveIt = process.env.RUN_OPENCLAW_GATEWAY_LIVE === "1" ? it : it.skip;

describe("OpenClaw gateway (live, opcional)", () => {
  liveIt("contacta o gateway e regista o resultado (ok ou diagnóstico)", async () => {
    const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
    if (!token) {
      throw new Error("Defina OPENCLAW_GATEWAY_TOKEN para este teste.");
    }

    const baseUrl = process.env.OPENCLAW_PROBE_URL?.trim() || "http://127.0.0.1:18789";

    const result = await runOpenClawProbeFromServer({ baseUrl, token });

    if (result.ok) {
      expect(result.ok).toBe(true);
      return;
    }

    // Falha esperada em muitos ambientes: imprimir diagnóstico para depuração local
    console.error("[openclaw live probe]", JSON.stringify(result.diagnostic, null, 2));

    expect(result.ok).toBe(false);
    expect(result.diagnostic.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(result.diagnostic.steps)).toBe(true);
  });
});
