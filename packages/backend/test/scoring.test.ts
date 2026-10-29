import { register } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";

import schema from "../convex/schema";
import { stubProvider } from "../convex/lib/providers/stub";
import { toImageDto } from "../convex/model/images";
import type { Doc, Id } from "../convex/_generated/dataModel";

/**
 * Scoring action (plan 6.2).
 *
 * Timings are injected through `lib/scoringPolicy` so the timeout path runs in
 * milliseconds: 40 ms per call, 300 ms total, 5 ms retry delay. The shape is
 * the production one (6 s / 10 s / 200 ms), only scaled down.
 */
vi.mock("../convex/lib/scoringPolicy", () => ({
  SCORING_CALL_TIMEOUT_MS: 40,
  SCORING_TOTAL_BUDGET_MS: 300,
  SCORING_RETRY_DELAY_MS: 5,
  SCORING_RETRY_JITTER_MS: 0,
}));

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;

type MarkReadyArgs = {
  imageId: Id<"images">;
  storageId: Id<"_storage">;
  previewId: Id<"_storage">;
  thumbId: Id<"_storage">;
  width: number;
  height: number;
};

const markReady = makeFunctionReference<"mutation", MarkReadyArgs, boolean>(
  "internal/images:markReady",
);

const score = makeFunctionReference<"action", { imageId: Id<"images"> }, void>(
  "actions/scoring:score",
);

const record = makeFunctionReference<
  "mutation",
  {
    imageId: Id<"images">;
    result: Record<string, unknown>;
    attempts: Record<string, unknown>[];
  },
  boolean
>("internal/scoring:record");

const tryCached = makeFunctionReference<
  "mutation",
  { imageId: Id<"images">; provider: "stub"; configVersion: string },
  boolean
>("internal/scoring:tryCached");

const SUCCESS_SHA = `61${"0".repeat(62)}`;
const UNAVAILABLE_SHA = `fa11face03${"0".repeat(54)}`;
const RETRYABLE_SHA = `fa11face00${"0".repeat(54)}`;
const FATAL_SHA = `fa11face01${"0".repeat(54)}`;
// 0x00c8 = 200 ms, well above the mocked 40 ms call timeout.
const DELAY_SHA = `fa11face0200c8${"0".repeat(50)}`;

async function insertScoringImage(
  t: Test,
  sha256: string,
  status: Doc<"images">["status"] = "scoring",
  userId = "user-1",
) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    );
    const imageId = await ctx.db.insert("images", {
      userId,
      sha256,
      storageId,
      mime: "image/jpeg",
      bytes: 3,
      width: 100,
      height: 100,
      status,
      scoringStartedAt: status === "scoring" ? Date.now() : undefined,
      createdAt: 1_700_000_000_000,
    });
    return { imageId, storageId };
  });
}

async function insertProcessingImage(t: Test) {
  return t.run(async (ctx) => {
    const store = () =>
      ctx.storage.store(new Blob([new Uint8Array([7])]));
    const [rawStorageId, storageId, previewId, thumbId] = await Promise.all([
      store(),
      store(),
      store(),
      store(),
    ]);
    const imageId = await ctx.db.insert("images", {
      userId: "user-1",
      sha256: SUCCESS_SHA,
      rawStorageId,
      mime: "image/jpeg",
      bytes: 1,
      status: "processing",
      processingStartedAt: Date.now(),
      createdAt: 1_700_000_000_000,
    });
    return { imageId, rawStorageId, storageId, previewId, thumbId };
  });
}

async function rows(t: Test) {
  return t.run(async (ctx) => ({
    image: await ctx.db.query("images").first(),
    scores: await ctx.db.query("scores").collect(),
    attempts: await ctx.db.query("scoringAttempts").collect(),
    audits: await ctx.db.query("auditEvents").collect(),
  }));
}

it("T-SCR-09 markReady enqueues and the scoring action lands a scored row", async () => {
  const t = convexTest(schema, modules);
  register(t, "scoringPool");
  const { imageId, storageId, previewId, thumbId } =
    await insertProcessingImage(t);

  expect(
    await t.mutation(markReady, {
      imageId,
      storageId,
      previewId,
      thumbId,
      width: 100,
      height: 100,
    }),
  ).toBe(true);

  const queued = await t.run(async (ctx) => ctx.db.get("images", imageId));
  expect(queued).toMatchObject({
    status: "scoring",
    scoringStartedAt: expect.any(Number),
  });
  expect(queued?.rawStorageId).toBeUndefined();

  // The workpool component itself cannot run under convex-test 0.0.62: its
  // nested batch-worker calls `paginate()` in component context, which the
  // harness rejects. The dev end-to-end run exercises the real pool; here the
  // enqueue is proven by `markReady` succeeding against the registered
  // component, and the queued action is invoked directly.
  await t.action(score, { imageId });

  const { image, scores, attempts, audits } = await rows(t);
  expect(image).toMatchObject({ status: "scored" });
  expect(image?.scoringStartedAt).toBeUndefined();
  expect(image?.scoreId).toBeDefined();

  expect(scores).toHaveLength(1);
  expect(scores[0]).toMatchObject({
    sha256: SUCCESS_SHA,
    score: 10,
    confidence: 0.95,
    faceCount: 1,
    status: "scored",
    reason: "Scored",
    provider: "stub",
    providerModel: "stub-v1",
    configVersion: "1",
    latencyMs: 1,
    costMicros: 0,
  });
  expect(scores[0]?._id).toBe(image?.scoreId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    imageId,
    provider: "stub",
    outcome: "success",
    latencyMs: expect.any(Number),
    at: expect.any(Number),
  });

  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actorId: "system:scoring",
    action: "score.record",
    docId: imageId,
  });
});

it("T-SCR-09 passes the stored WebP unchanged to a provider that accepts it", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await insertScoringImage(t, SUCCESS_SHA);

  const spy = vi.spyOn(stubProvider, "score");
  try {
    await t.action(score, { imageId });

    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0]?.[0];
    expect(input?.mime).toBe("image/webp");
    expect(Array.from(input?.bytes ?? [])).toEqual([1, 2, 3]);
  } finally {
    spy.mockRestore();
  }
});

it("T-SCR-10 a retryable error records two attempts and ends unavailable", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await insertScoringImage(t, RETRYABLE_SHA);

  await t.action(score, { imageId });

  const { image, scores, attempts, audits } = await rows(t);
  expect(image).toMatchObject({ status: "scored" });
  expect(scores[0]).toMatchObject({
    status: "unavailable",
    score: null,
    reason: "Scoring is unavailable",
  });
  expect(attempts).toHaveLength(2);
  expect(attempts.map((attempt) => attempt.outcome)).toEqual([
    "retryable_error",
    "retryable_error",
  ]);
  expect(attempts.every((attempt) => attempt.errorCode === "stub_retryable")).toBe(
    true,
  );
  expect(audits[0]).toMatchObject({ action: "score.fail" });
});

it("T-SCR-10 a fatal error records one attempt and is not retried", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await insertScoringImage(t, FATAL_SHA);

  await t.action(score, { imageId });

  const { image, scores, attempts, audits } = await rows(t);
  expect(image).toMatchObject({ status: "scored" });
  expect(scores[0]).toMatchObject({ status: "unavailable" });
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    outcome: "fatal_error",
    errorCode: "stub_fatal",
  });
  expect(audits[0]).toMatchObject({ action: "score.fail" });
});

it("T-SCR-10 a call over the timeout aborts and retries once", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await insertScoringImage(t, DELAY_SHA);

  await t.action(score, { imageId });

  const { scores, attempts } = await rows(t);
  expect(scores[0]).toMatchObject({ status: "unavailable" });
  expect(attempts.map((attempt) => attempt.outcome)).toEqual([
    "timeout",
    "timeout",
  ]);
  expect(attempts.every((attempt) => attempt.errorCode === "timeout")).toBe(true);
});

it("T-SCR-11 a second score run is a no-op", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await insertScoringImage(t, SUCCESS_SHA);

  await t.action(score, { imageId });
  const first = await rows(t);
  expect(first.image?.status).toBe("scored");

  await t.action(score, { imageId });
  const second = await rows(t);
  expect(second.scores).toHaveLength(1);
  expect(second.attempts).toHaveLength(1);
  expect(second.audits).toHaveLength(1);
});

it("T-SCR-11 record on a row that is not scoring writes nothing", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await insertScoringImage(t, SUCCESS_SHA, "scored");
  const before = await rows(t);

  const written = await t.mutation(record, {
    imageId,
    result: {
      score: 50,
      confidence: 0.9,
      faceCount: 1,
      status: "scored",
      reason: "Scored",
      provider: "stub",
      providerModel: "stub-v1",
      configVersion: "1",
      latencyMs: 1,
      costMicros: 0,
    },
    attempts: [
      {
        provider: "stub",
        outcome: "success",
        latencyMs: 1,
        at: Date.now(),
      },
    ],
  });

  expect(written).toBe(false);
  const after = await rows(t);
  expect(after.scores).toHaveLength(before.scores.length);
  expect(after.attempts).toHaveLength(0);
  expect(after.audits).toHaveLength(0);
});

it("T-SCR-12 a second image with the same sha links the cached score without a provider call", async () => {
  const t = convexTest(schema, modules);
  const first = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-1");
  const second = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-2");

  const spy = vi.spyOn(stubProvider, "score");
  try {
    await t.action(score, { imageId: first.imageId });
    expect(spy).toHaveBeenCalledTimes(1);
    await t.action(score, { imageId: second.imageId });
    // The cache hit stopped the action before the provider was reached.
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }

  const { scores, attempts, audits } = await t.run(async (ctx) => ({
    scores: await ctx.db.query("scores").collect(),
    attempts: await ctx.db.query("scoringAttempts").collect(),
    audits: await ctx.db.query("auditEvents").collect(),
  }));
  expect(scores).toHaveLength(1);

  const [firstImage, secondImage] = await t.run((ctx) =>
    Promise.all([
      ctx.db.get("images", first.imageId),
      ctx.db.get("images", second.imageId),
    ]),
  );
  expect(firstImage).toMatchObject({ status: "scored", scoreCached: false });
  expect(secondImage).toMatchObject({ status: "scored", scoreCached: true });
  expect(secondImage?.scoreId).toBe(firstImage?.scoreId);
  expect(attempts.map((attempt) => attempt.imageId)).toEqual([first.imageId]);
  expect(
    audits
      .filter((audit) => audit.action === "score.record")
      .map((audit) => audit.after?.cached),
  ).toEqual([false, true]);

  const dtoFor = (imageId: Id<"images">) =>
    t.run(async (ctx) => {
      const image = await ctx.db.get("images", imageId);
      if (image === null) throw new Error(`missing image ${imageId}`);
      return toImageDto(ctx, image);
    });
  expect((await dtoFor(first.imageId)).score?.cached).toBe(false);
  expect((await dtoFor(second.imageId)).score?.cached).toBe(true);
});

it("T-SCR-12 a config version bump misses the cache", async () => {
  const t = convexTest(schema, modules);
  const first = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-1");
  const second = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-2");

  await t.action(score, { imageId: first.imageId });

  const bumped = await t.mutation(tryCached, {
    imageId: second.imageId,
    provider: "stub",
    configVersion: "2",
  });
  expect(bumped).toBe(false);
  expect(await t.run((ctx) => ctx.db.get("images", second.imageId))).toMatchObject(
    { status: "scoring" },
  );

  // The same key with the current version still hits.
  const hit = await t.mutation(tryCached, {
    imageId: second.imageId,
    provider: "stub",
    configVersion: "1",
  });
  expect(hit).toBe(true);
});

it("T-SCR-12 an unavailable row is never served from the cache", async () => {
  const t = convexTest(schema, modules);
  const first = await insertScoringImage(t, UNAVAILABLE_SHA, "scoring", "user-1");
  const second = await insertScoringImage(t, UNAVAILABLE_SHA, "scoring", "user-2");

  const spy = vi.spyOn(stubProvider, "score");
  try {
    await t.action(score, { imageId: first.imageId });
    await t.action(score, { imageId: second.imageId });
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }

  const { scores } = await t.run(async (ctx) => ({
    scores: await ctx.db.query("scores").collect(),
  }));
  expect(scores).toHaveLength(2);
  expect(scores.every((score) => score.status === "unavailable")).toBe(true);

  const [firstImage, secondImage] = await t.run((ctx) =>
    Promise.all([
      ctx.db.get("images", first.imageId),
      ctx.db.get("images", second.imageId),
    ]),
  );
  expect(firstImage?.scoreId).toBeDefined();
  expect(secondImage?.scoreId).toBeDefined();
  expect(secondImage?.scoreId).not.toBe(firstImage?.scoreId);
  expect(secondImage?.scoreCached).toBe(false);
});

it("T-SCR-12 concurrent misses link the second record to the first row", async () => {
  const t = convexTest(schema, modules);
  const first = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-1");
  const second = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-2");

  const result = {
    score: 42,
    confidence: 0.9,
    faceCount: 1,
    status: "scored",
    reason: "Scored",
    provider: "stub",
    providerModel: "stub-v1",
    configVersion: "1",
    latencyMs: 1,
    costMicros: 0,
  };
  const attempt = {
    provider: "stub",
    outcome: "success",
    latencyMs: 1,
    at: 1,
  };

  await t.mutation(record, { imageId: first.imageId, result, attempts: [attempt] });
  await t.mutation(record, {
    imageId: second.imageId,
    result: { ...result, score: 43 },
    attempts: [attempt],
  });

  const { scores, attempts } = await t.run(async (ctx) => ({
    scores: await ctx.db.query("scores").collect(),
    attempts: await ctx.db.query("scoringAttempts").collect(),
  }));
  expect(scores).toHaveLength(1);
  expect(scores[0]?.score).toBe(42);

  const [firstImage, secondImage] = await t.run((ctx) =>
    Promise.all([
      ctx.db.get("images", first.imageId),
      ctx.db.get("images", second.imageId),
    ]),
  );
  expect(secondImage?.scoreId).toBe(firstImage?.scoreId);
  expect(firstImage?.scoreCached).toBe(false);
  expect(secondImage?.scoreCached).toBe(true);
  expect(attempts).toHaveLength(2);
});

it("T-SCR-12 the cache lookup ignores unbounded outage history under the key", async () => {
  const t = convexTest(schema, modules);
  const image = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-2");

  const cacheableId = await t.run(async (ctx) => {
    const base = {
      sha256: SUCCESS_SHA,
      score: 42,
      confidence: 0.9,
      faceCount: 1,
      reason: "Scored",
      provider: "stub" as const,
      providerModel: "stub-v1",
      configVersion: "1",
      latencyMs: 1,
      createdAt: 1,
    };
    // 50 outage rows share the key; only the cacheable row is visible through
    // `by_cache_entry` with `cacheable: true`, so the lookup reads at most one
    // document regardless of how many outages accumulated.
    for (let index = 0; index < 50; index += 1) {
      await ctx.db.insert("scores", {
        ...base,
        status: "unavailable",
        score: null,
        confidence: null,
        faceCount: 0,
        reason: "Scoring is unavailable",
        cacheable: false,
        createdAt: 2 + index,
      });
    }
    return ctx.db.insert("scores", {
      ...base,
      status: "scored",
      cacheable: true,
    });
  });

  const hit = await t.mutation(tryCached, {
    imageId: image.imageId,
    provider: "stub",
    configVersion: "1",
  });
  expect(hit).toBe(true);
  expect(await t.run((ctx) => ctx.db.get("images", image.imageId))).toMatchObject({
    status: "scored",
    scoreId: cacheableId,
    scoreCached: true,
  });
});

it("T-SCR-12 a concurrent link audits the linked row's status", async () => {
  const t = convexTest(schema, modules);
  const first = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-1");
  const second = await insertScoringImage(t, SUCCESS_SHA, "scoring", "user-2");

  const result = {
    score: 42,
    confidence: 0.9,
    faceCount: 1,
    status: "scored",
    reason: "Scored",
    provider: "stub",
    providerModel: "stub-v1",
    configVersion: "1",
    latencyMs: 1,
    costMicros: 0,
  };
  const attempt = {
    provider: "stub",
    outcome: "success",
    latencyMs: 1,
    at: 1,
  };

  await t.mutation(record, {
    imageId: first.imageId,
    result,
    attempts: [attempt],
  });
  // This run's discarded result says `multiple_faces`; the image gets the
  // existing `scored` row, and the audit must say so.
  await t.mutation(record, {
    imageId: second.imageId,
    result: { ...result, status: "multiple_faces", reason: "Scored 2 faces" },
    attempts: [attempt],
  });

  const [secondImage, audits] = await t.run((ctx) =>
    Promise.all([
      ctx.db.get("images", second.imageId),
      ctx.db.query("auditEvents").collect(),
    ]),
  );
  expect(secondImage?.scoreCached).toBe(true);
  const secondAudit = audits.find((audit) => audit.docId === second.imageId);
  expect(secondAudit).toMatchObject({
    action: "score.record",
    after: {
      scoreId: secondImage?.scoreId,
      scoreStatus: "scored",
      cached: true,
    },
  });
});
