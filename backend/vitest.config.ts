import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setupEnv.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The integration test mutates env before importing modules that read it.
    fileParallelism: false,
  },
});
