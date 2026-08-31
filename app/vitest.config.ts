import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Ver worker/vitest.config.ts: los tests de integración comparten una única Postgres real.
    fileParallelism: false,
  },
});
