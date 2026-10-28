import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      // `convex/env.ts` validates process.env at module load, so tests need a
      // valid environment before the module is imported. Values are local.
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-32",
      SITE_URL: "http://localhost:3001",
    },
  },
});
