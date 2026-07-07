import { defineConfig } from "vitest/config";
import path from "node:path";
import { existsSync } from "node:fs";

// Server-only routers read DATABASE_URL at import time. Unlike `next dev`
// (which loads .env.local automatically), a bare `vitest run` doesn't --
// without this, the suite fails before a single test runs whenever
// DATABASE_URL isn't already exported in the shell.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
