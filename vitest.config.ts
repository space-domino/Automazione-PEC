import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    clearMocks: true,
    // Env fittizio per gli unit test: soddisfa lib/env.ts, nessun servizio reale.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://app:app@localhost:5432/app_test?schema=public",
      REDIS_URL: "redis://localhost:6379",
      AUTH_SECRET: "test-secret-0123456789-0123456789-0123456789",
      AUTH_URL: "http://localhost:3000",
      APP_BASE_URL: "http://localhost:3000",
      PUBLIC_BASE_URL: "http://localhost:3000",
      DATA_ENCRYPTION_KEY: "0123456789012345678901234567890123456789012=",
      TOKEN_SIGNING_KEY: "token-signing-key-0123456789-0123456789",
    },
  },
});
