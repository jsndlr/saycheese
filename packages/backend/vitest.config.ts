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
          exclude: ["test/runtime.test.ts", "test/schema.test.ts", "test/upload.test.ts", "test/images-queries.test.ts", "test/seed.test.ts", "test/storage-sweep.test.ts", "test/image-processing.test.ts", "test/stuck-images.test.ts"],
          env: testEnv,
        },
      },
      {
        test: {
          name: "edge",
          include: ["test/runtime.test.ts", "test/schema.test.ts", "test/upload.test.ts", "test/images-queries.test.ts", "test/seed.test.ts", "test/storage-sweep.test.ts", "test/image-processing.test.ts", "test/stuck-images.test.ts"],
          environment: "edge-runtime",
          // convex-test edge suites (55-row pagination, seed, upload) exceed the
          // 5 s default under the CPU contention of a root `pnpm test` run.
          testTimeout: 20_000,
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