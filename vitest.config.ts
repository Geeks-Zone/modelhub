import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    exclude: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "apps/**",
      "packages/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["lib/**/*.ts", "server/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "server/tests/**",
        "generated/**",
      ],
      thresholds: {
        statements: 55,
        branches: 50,
        functions: 55,
        lines: 55,
      },
    },
  },
});
