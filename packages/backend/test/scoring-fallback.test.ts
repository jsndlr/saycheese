import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";

import schema from "../convex/schema";
import { ProviderError } from "../convex/lib/providers/types";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Fallback rules (plan 6.2 T-SCR-13). The primary is a mocked Rekognition and
 * the fallback a mocked Vision; the action's real retry/record/cache wiring is
 * exercised under convex-test. Timings are the same scaled-down values as
 * scoring.test.ts.
 */

vi.mock("../convex/lib/scoringPolicy", () => ({
  SCORING_CALL_TIMEOUT_MS: 40,
  SCORING_TOTAL_BUDGET_MS: 300,
  SCORING_RETRY_DELAY_MS: 5,
  SCORING_RETRY_JITTER_MS: 0,
}));

vi.mock("../convex/env", () => ({
  env: {
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-32",
    SITE_URL: "http://localhost:3001",
    SMILE_PROVIDER: "rekognition",
    SMILE_DAILY_QUOTA: 100,
    SCORING_CONFIG_VERSION: "1",
    LOG_LEVEL: "info",
  },
}));

const mocks = vi.hoisted(() => ({
  primaryScore: vi.fn(),
  fallbackScore: vi.fn(),
  fallbackAvailable: true,
}));

vi.mock("../convex/lib/providers", async () => {
  const { ProviderError: ErrorClass } = await import("../convex/lib/providers/types");
  const primary = {
    name: "rekognition" as const,
    model: "rekognition-detectfaces",
    acceptedMimes: ["image/webp"] as const,
    score: mocks.primaryScore,
  };
  const fallback = {
    name: "vision" as const,
    model: "vision-face-detection",
    acceptedMimes: ["image/webp"] as const,
    score: mocks.fallbackScore,
  };

  return {
    providerOrder: () => ["rekognition", "vision"] as const,
    providerFor: (name: string) => {
      if (name === "rekognition") return primary;
      if (!mocks.fallbackAvailable) {
        throw new ErrorClass(
          "fatal",
          "missing_credentials",
          "GOOGLE_APPLICATION_CREDENTIALS_JSON is not set.",
        );
      }
      return fallback;
    },
    primaryProvider: () => primary,
  };
});

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;

const score = makeFunctionReference<"action", { imageId: Id<"images">; run: number }, void>(
  "actions/scoring:score",
);

const SAME_SHA = `61${"0".repeat(62)}`;

async function insertScoringImage(t: Test) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    );
    const imageId = await ctx.db.insert("images", {
      userId: "user-1",
      sha256: SAME_SHA,
      storageId,
      mime: "image/jpeg",
      bytes: 3,
      width: 100,
      height: 100,
      status: "scoring",
      scoringStartedAt: Date.now(),
      scoringRun: 1,
      createdAt: 1_700_000_000_000,
    });
    return imageId;
  });
}

const retryable = () =>
  new ProviderError("retryable", "rekognition_throttled", "slow down");
const fatal = () => new ProviderError("fatal", "rekognition_auth", "denied");

const visionResult = {
  faces: [
    {
      area: 900,
      smileConfidence: 0,
      smileValue: null,
      faceConfidence: 97,
    },
  ],
  joyLikelihood: "VERY_LIKELY",
  latencyMs: 1,
  costMicros: 1_500,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fallbackAvailable = true;
});

it("T-SCR-13 falls back to Vision after two retryable Rekognition failures", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const imageId = await insertScoringImage(t);

  mocks.primaryScore.mockRejectedValue(retryable());
  mocks.fallbackScore.mockResolvedValue(visionResult);

  await t.action(score, { imageId, run: 1 });

  const { scores, attempts, audits } = await t.run(async (ctx) => ({
    scores: await ctx.db.query("scores").collect(),
    attempts: await ctx.db.query("scoringAttempts").collect(),
    audits: await ctx.db.query("auditEvents").collect(),
  }));

  expect(mocks.primaryScore).toHaveBeenCalledTimes(2);
  expect(mocks.fallbackScore).toHaveBeenCalledTimes(1);
  expect(scores).toHaveLength(1);
  expect(scores[0]).toMatchObject({
    status: "scored",
    score: 90,
    provider: "vision",
    providerModel: "vision-face-detection",
    configVersion: "1",
  });
  expect(attempts.map((attempt) => [attempt.provider, attempt.outcome])).toEqual([
    ["rekognition", "retryable_error"],
    ["rekognition", "retryable_error"],
    ["vision", "success"],
  ]);
  expect(audits[0]).toMatchObject({ action: "score.record" });
});

it("T-SCR-13 a fatal primary error does not call the fallback", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const imageId = await insertScoringImage(t);

  mocks.primaryScore.mockRejectedValue(fatal());

  await t.action(score, { imageId, run: 1 });

  const { scores, attempts, audits } = await t.run(async (ctx) => ({
    scores: await ctx.db.query("scores").collect(),
    attempts: await ctx.db.query("scoringAttempts").collect(),
    audits: await ctx.db.query("auditEvents").collect(),
  }));

  expect(mocks.primaryScore).toHaveBeenCalledTimes(1);
  expect(mocks.fallbackScore).not.toHaveBeenCalled();
  expect(scores[0]).toMatchObject({
    status: "unavailable",
    reason: "Scoring is unavailable",
    provider: "rekognition",
  });
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ provider: "rekognition", outcome: "fatal_error" });
  expect(audits[0]).toMatchObject({ action: "score.fail" });
});

it("T-SCR-13 records every attempt when both providers fail", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const imageId = await insertScoringImage(t);

  mocks.primaryScore.mockRejectedValue(retryable());
  mocks.fallbackScore.mockRejectedValue(
    new ProviderError("retryable", "vision_unavailable", "down"),
  );

  await t.action(score, { imageId, run: 1 });

  const { scores, attempts, audits } = await t.run(async (ctx) => ({
    scores: await ctx.db.query("scores").collect(),
    attempts: await ctx.db.query("scoringAttempts").collect(),
    audits: await ctx.db.query("auditEvents").collect(),
  }));

  const calls = mocks.primaryScore.mock.calls.length + mocks.fallbackScore.mock.calls.length;
  expect(calls).toBeGreaterThanOrEqual(3);
  expect(attempts).toHaveLength(calls);
  expect(new Set(attempts.map((attempt) => attempt.provider))).toEqual(
    new Set(["rekognition", "vision"]),
  );
  expect(scores[0]).toMatchObject({
    status: "unavailable",
    score: null,
    reason: "Scoring is unavailable",
    provider: "rekognition",
  });
  expect(audits[0]).toMatchObject({ action: "score.fail" });
});

it("T-SCR-13 skips a fallback that cannot be constructed", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const imageId = await insertScoringImage(t);

  mocks.fallbackAvailable = false;
  mocks.primaryScore.mockRejectedValue(retryable());

  await t.action(score, { imageId, run: 1 });

  const { scores, attempts } = await t.run(async (ctx) => ({
    scores: await ctx.db.query("scores").collect(),
    attempts: await ctx.db.query("scoringAttempts").collect(),
  }));

  expect(mocks.primaryScore).toHaveBeenCalledTimes(2);
  expect(mocks.fallbackScore).not.toHaveBeenCalled();
  expect(attempts).toHaveLength(2);
  expect(scores[0]).toMatchObject({
    status: "unavailable",
    reason: "Scoring is unavailable",
    provider: "rekognition",
    providerModel: "rekognition-detectfaces",
  });
});

it("T-SCR-13 a failing fallback is not retried beyond the remaining budget", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const imageId = await insertScoringImage(t);

  mocks.primaryScore.mockRejectedValue(retryable());
  mocks.fallbackScore.mockRejectedValue(fatal());

  await t.action(score, { imageId, run: 1 });

  const { scores, attempts } = await t.run(async (ctx) => ({
    scores: await ctx.db.query("scores").collect(),
    attempts: await ctx.db.query("scoringAttempts").collect(),
  }));

  expect(mocks.fallbackScore).toHaveBeenCalledTimes(1);
  expect(attempts.map((attempt) => attempt.provider)).toEqual([
    "rekognition",
    "rekognition",
    "vision",
  ]);
  expect(attempts[2]).toMatchObject({ outcome: "fatal_error" });
  expect(scores[0]).toMatchObject({ status: "unavailable" });
});