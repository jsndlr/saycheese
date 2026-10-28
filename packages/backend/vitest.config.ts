import { defineConfig } from "vitest/config";

const testEnv = {
  // `convex/env.ts` validates process.env at module load, so tests need a
  // valid environment before the module is imported. Values are fake and local.
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-32",
  SITE_URL: "http://localhost:3001",
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/runtime.test.ts", "test/schema.test.ts", "test/upload.test.ts", "test/images-queries.test.ts"],
          env: testEnv,
        },
      },
      {
        test: {
          name: "edge",
          include: ["test/runtime.test.ts", "test/schema.test.ts", "test/upload.test.ts", "test/images-queries.test.ts"],
          environment: "edge-runtime",
          env: testEnv,
          server: {
            deps: {
              inline: ["@convex-dev/better-auth"],
            },
          },
        },
      },
    ],
  },
});