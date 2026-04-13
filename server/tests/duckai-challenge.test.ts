import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

import { deobfuscateChallenge } from "../providers/duckai-challenge";

async function runChallenge(script: string) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://duck.ai/",
  });

  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = `
    window.__challengeResult = (async function() {
      try {
        return await (${deobfuscateChallenge(script)});
      } catch (error) {
        return {
          __error: error instanceof Error ? error.message : String(error),
        };
      }
    })();
  `;
  dom.window.document.head.appendChild(scriptEl);

  const result = await (dom.window as unknown as typeof globalThis & {
    __challengeResult: Promise<unknown>;
  }).__challengeResult;

  dom.window.close();
  return result;
}

describe("Duck.ai challenge deobfuscation", () => {
  it("guards null contentDocument access in dot notation", async () => {
    const result = await runChallenge(
      "(async function(){ const frame = null; return !!frame.contentDocument; })()",
    );

    expect(result).toBe(true);
  });

  it("guards null contentWindow access in bracket notation", async () => {
    const result = await runChallenge(
      "(async function(){ const frame = null; return frame['contentWindow'] === window; })()",
    );

    expect(result).toBe(true);
  });

  it("keeps iframe probes from crashing when jsdom yields null frame accessors", async () => {
    const result = await runChallenge(
      "(async function(){ const frame = document.createElement('iframe'); document.body.appendChild(frame); return !!frame.contentDocument && !!frame.contentWindow; })()",
    );

    expect(result).toBe(true);
  });

  it("rewrites obfuscated string-key access for contentWindow/contentDocument", async () => {
    const result = await runChallenge(
      "(async function(){ const keys = ['contentWindow', 'contentDocument']; const frame = { contentWindow: null }; return !!frame[keys[0]][keys[1]]; })()",
    );

    expect(result).toBe(true);
  });
});
