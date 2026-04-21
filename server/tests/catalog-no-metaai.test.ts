import { describe, expect, it } from "vitest";

import { PROVIDER_CATALOG } from "../lib/catalog";

/**
 * O provider Meta AI foi removido (scraping não oficial, instável).
 */
describe("PROVIDER_CATALOG", () => {
  it("não inclui metaai", () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    expect(ids).not.toContain("metaai");
  });
});
