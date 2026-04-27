import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    exclude: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "apps/**",
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
        // Baseline inicial: suficientemente rigoroso para evitar regressão,
        // mas compatível com a cobertura real da suíte atual.
        statements: 40,
        branches: 50,
        functions: 40,
        lines: 40,
      },
    },
  },
});
