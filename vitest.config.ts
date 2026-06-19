import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./vitest.global-setup.ts"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/*.e2e.test.ts",
    ],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
