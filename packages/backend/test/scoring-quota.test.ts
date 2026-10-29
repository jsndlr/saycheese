import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { ERROR_MESSAGES } from "@saycheese/core/errors";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeAll, expect, it, vi } from "vitest";

import schema from "../convex/schema";
import type { Doc, Id } from "../convex/_generated/dataModel";

// The action reads `SMILE_DAILY_QUOTA` at call time; two is enough to prove
// the third provider-bound image is denied while a cache hit stays free.
vi.mock("../convex/env", () => ({
  env: {
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-32",
    SITE_URL: "http://localhost:3001",
    SMILE_PROVIDER: "stub",
    SMILE_DAILY_QUOTA: 2,
    SCORING_CONFIG_VERSION: "1",
    LOG_LEVEL: "error",
  },
}));

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;

const score = makeFunctionReference<"action", { imageId: Id<"images">; run: number }, void>(
  "actions/scoring:score",
);

function sha(prefix: string): string {
  return `${prefix}${"0".repeat(64 - prefix.length)}`;
}

async function insertScoringImage(t: Test, hash: string) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    );
    const imageId = await ctx.db.insert("images", {
      userId: "quota-user",
      sha256: hash,
      storageId,
      mime: "image/webp",
      bytes: 3,
      width: 100,
      height: 100,
      status: "scoring",
      scoringStartedAt: Date.now(),
      scoringRun: 1,
      createdAt: 1_700_000_000_000,
    });
    return { imageId, storageId };
  });
}

beforeAll(() => {
  expect(ERROR_MESSAGES.SCORING_QUOTA).toBe("Daily scoring limit reached.");
});

it("T-SEC-05: the daily quota settles the image as scored/unavailable and keeps variants", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");

  const first = await insertScoringImage(t, sha("61"));
  const second = await insertScoringImage(t, sha("62"));
  const third = await insertScoringImage(t, sha("63"));

  await t.action(score, { imageId: first.imageId, run: 1 });
  await t.action(score, { imageId: second.imageId, run: 1 });
  await t.action(score, { imageId: third.imageId, run: 1 });

  const rows = await t.run(async (ctx) => ({
    first: await ctx.db.get("images", first.imageId),
    second: await ctx.db.get("images", second.imageId),
    third: await ctx.db.get("images", third.imageId),
    thirdScore:
      (await ctx.db.get("images", third.imageId))?.scoreId === undefined
        ? null
        : await ctx.db.get(
            "scores",
            (await ctx.db.get("images", third.imageId))!.scoreId!,
          ),
  }));

  expect(rows.first).toMatchObject({ status: "scored" });
  expect(rows.first?.quotaExceeded).toBeUndefined();
  expect(rows.second).toMatchObject({ status: "scored" });
  expect(rows.third).toMatchObject({
    status: "scored",
    quotaExceeded: true,
    // The image itself is fine: its variants are still linked.
    storageId: third.storageId,
  });
  expect(rows.thirdScore).toMatchObject({
    status: "unavailable",
    reason: ERROR_MESSAGES.SCORING_QUOTA,
    score: null,
    cacheable: false,
  });
});

it("T-SEC-05: a cache hit is free even after the daily quota is exhausted", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");

  const first = await insertScoringImage(t, sha("71"));
  const second = await insertScoringImage(t, sha("72"));
  await t.action(score, { imageId: first.imageId, run: 1 });
  await t.action(score, { imageId: second.imageId, run: 1 });

  const cachedSha = sha("73");
  const { imageId, storageId } = await insertScoringImage(t, cachedSha);
  const cachedScoreId = await t.run(async (ctx) =>
    ctx.db.insert("scores", {
      sha256: cachedSha,
      score: 55,
      confidence: 0.9,
      faceCount: 1,
      status: "scored" as Doc<"scores">["status"],
      reason: "Scored",
      provider: "stub" as const,
      providerModel: "stub-v1",
      configVersion: "1",
      latencyMs: 1,
      costMicros: 0,
      cacheable: true,
      createdAt: 1_700_000_000_000,
    }),
  );

  await t.action(score, { imageId, run: 1 });

  const image = await t.run(async (ctx) => ctx.db.get("images", imageId));
  expect(image).toMatchObject({
    status: "scored",
    scoreId: cachedScoreId,
    scoreCached: true,
    storageId,
  });
  expect(image?.quotaExceeded).toBeUndefined();
});
