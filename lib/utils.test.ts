import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("combina classes condicionais e resolve conflitos do tailwind", () => {
    expect(cn("px-2", false && "hidden", "px-4", ["text-sm", null], { block: true })).toBe(
      "px-4 text-sm block",
    );
  });
});
