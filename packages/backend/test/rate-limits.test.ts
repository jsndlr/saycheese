import type { ComponentApi } from "@convex-dev/better-auth/_generated/component.js";
import { register } from "@convex-dev/better-auth/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { UNAVAILABLE_REASON } from "@saycheese/core/scoring";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";

import schema from "../convex/schema";
import type { Doc, Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;

const createUpload = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { uploadUrl: string; expiresAt: number }
>("commands/images:createUpload");

const score = makeFunctionReference<
  "action",
  { imageId: Id<"images">; run: number; force?: boolean },
  void
>("actions/scoring:score");

const commitUpload = makeFunctionReference<
  "mutation",
  { storageId: Id<"_storage">; sha256: string; bytes: number; mime: string },
  { id: Id<"images">; deduplicated: boolean }
>("commands/images:commitUpload");

const rescore = makeFunctionReference<
  "mutation",
  { id: Id<"images">; force?: boolean },
  { id: Id<"images">; status: Doc<"images">["status"] }
>("commands/images:rescore");

type ErrorData = { code?: string; detail?: { retryAfterMs?: number } };

async function rejection(promise: Promise<unknown>): Promise<ConvexError<ErrorData>> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error;
    return error as ConvexError<ErrorData>;
  }
  throw new Error("Expected the call to reject");
}

async function signedIn(t: Test, email = "rate@example.test") {
  const component: ComponentApi = register(t, "betterAuth");
  const now = Date.now();
  const user = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "user",
        data: { name: email, email, emailVerified: true, createdAt: now, updatedAt: now },
      },
    }),
  );
  const session = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "session",
        data: {
          token: `token-${email}`,
          userId: user._id,
          expiresAt: now + 10 * 365 * 24 * 60 * 60 * 1000,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  return {
    userId: user._id,
    asUser: t.withIdentity({ subject: user._id, sessionId: session._id }),
  };
}

function harness() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerWorkpool(t, "scoringPool");
  return t;
}

afterEach(() => {
  vi.useRealTimers();
});

const encoder = new TextEncoder();

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function commitBytes(
  t: Test,
  asUser: ReturnType<Test["withIdentity"]>,
  bytes: Uint8Array<ArrayBuffer>,
  mime = "image/jpeg",
) {
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob([bytes])),
  );
  return await asUser.mutation(commitUpload, {
    storageId,
    sha256: await sha256Hex(bytes),
    bytes: bytes.length,
    mime,
  });
}



it("T-SEC-05: the 31st committed upload is RATE_LIMITED even through one URL; a dedupe hit is free", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);

  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();

  // One minted URL, reused for every upload: the limit must protect commits.
  const { uploadUrl } = await asUser.mutation(createUpload, {});
  expect(typeof uploadUrl).toBe("string");

  for (let index = 0; index < 30; index += 1) {
    const committed = await commitBytes(t, asUser, encoder.encode(`upload-${index}`));
    expect(committed.deduplicated).toBe(false);
  }

  // A dedupe hit creates nothing and still works with an exhausted budget.
  // (Pre-inserted so the timing of the process action cannot turn it failed.)
  const dedupeBytes = encoder.encode("already-here");
  const existingId = await t.run(async (ctx) =>
    ctx.db.insert("images", {
      userId,
      sha256: await sha256Hex(dedupeBytes),
      mime: "image/jpeg",
      bytes: dedupeBytes.length,
      status: "scored",
      createdAt: Date.now(),
    }),
  );
  const duplicate = await commitBytes(t, asUser, dedupeBytes);
  expect(duplicate).toEqual({ id: existingId, deduplicated: true });

  const denied = await rejection(
    commitBytes(t, asUser, encoder.encode("upload-30")),
  );
  expect(denied.data).toMatchObject({ code: "RATE_LIMITED" });
  expect(denied.data.detail?.retryAfterMs).toBeGreaterThan(0);

  // URL minting has its own, looser allowance.
  const anotherUrl = await asUser.mutation(createUpload, {});
  expect(typeof anotherUrl.uploadUrl).toBe("string");

  // Two hours is past the token bucket's full refill window.
  vi.setSystemTime(start + 2 * 60 * 60 * 1000);
  const allowed = await commitBytes(t, asUser, encoder.encode("upload-after-window"));
  expect(allowed.deduplicated).toBe(false);
});

async function insertImage(
  t: Test,
  status: Doc<"images">["status"],
  options: { scoreStatus?: Doc<"scores">["status"]; reason?: string; scoreId?: boolean } = {},
) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([new Uint8Array([9])]));
    const imageId = await ctx.db.insert("images", {
      userId: "user-1",
      sha256: `${Math.random().toString(16).slice(2).padEnd(1, "0")}`.padEnd(64, "0").slice(0, 64),
      storageId,
      mime: "image/webp",
      bytes: 1,
      status,
      createdAt: Date.now(),
      ...(options.scoreStatus === undefined
        ? {}
        : {
            scoreId: await ctx.db.insert("scores", {
              sha256: "a".repeat(64),
              score: options.scoreStatus === "unavailable" ? null : 50,
              confidence: options.scoreStatus === "unavailable" ? null : 0.9,
              faceCount: 1,
              status: options.scoreStatus,
              reason: options.reason ?? "Scored",
              provider: "stub" as const,
              providerModel: "stub-v1",
              configVersion: "1",
              latencyMs: 1,
              cacheable: options.scoreStatus !== "unavailable",
              createdAt: Date.now(),
            }),
          }),
    });
    return imageId;
  });
}

it("rescore: unavailable score moves the image back to scoring and enqueues", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);
  const imageId = await insertImage(t, "scored", {
    scoreStatus: "unavailable",
    reason: UNAVAILABLE_REASON,
  });
  await t.run(async (ctx) => ctx.db.patch("images", imageId, { userId }));

  const result = await asUser.mutation(rescore, { id: imageId });
  expect(result.status).toBe("scoring");

  const row = await t.run(async (ctx) => ctx.db.get("images", imageId));
  expect(row).toMatchObject({ status: "scoring", scoringStartedAt: expect.any(Number) });
  expect(row?.scoreId).toBeUndefined();
  expect(row?.scoreCached).toBeUndefined();

  const audits = await t.run(async (ctx) => ctx.db.query("auditEvents").collect());
  expect(audits.some((audit) => audit.action === "image.rescore")).toBe(true);
});

it("rescore: a real score without force is an idempotent no-op", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);
  const imageId = await insertImage(t, "scored", { scoreStatus: "scored" });
  await t.run(async (ctx) => ctx.db.patch("images", imageId, { userId }));
  const before = await t.run(async (ctx) => ctx.db.get("images", imageId));

  const result = await asUser.mutation(rescore, { id: imageId });

  expect(result.status).toBe("scored");
  expect(await t.run(async (ctx) => ctx.db.get("images", imageId))).toEqual(before);
  expect(await t.run(async (ctx) => ctx.db.query("auditEvents").collect())).toHaveLength(0);
  expect(
    await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(0);
});

it("rescore: force re-scores a real result", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);
  const imageId = await insertImage(t, "scored", { scoreStatus: "scored" });
  await t.run(async (ctx) => ctx.db.patch("images", imageId, { userId }));

  const result = await asUser.mutation(rescore, { id: imageId, force: true });

  expect(result.status).toBe("scoring");
  expect(await t.run(async (ctx) => ctx.db.get("images", imageId))).toMatchObject({
    status: "scoring",
  });
});

it("rescore: failed and archived images are VALIDATION_FAILED", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);
  const failed = await insertImage(t, "failed");
  const archived = await insertImage(t, "scored", { scoreStatus: "unavailable" });
  await t.run(async (ctx) => {
    await ctx.db.patch("images", failed, { userId });
    await ctx.db.patch("images", archived, { userId, archivedAt: Date.now() });
  });

  for (const id of [failed, archived]) {
    const error = await rejection(asUser.mutation(rescore, { id }));
    expect(error.data).toMatchObject({ code: "VALIDATION_FAILED" });
  }
});

async function insertOutageImage(t: Test, userId: string) {
  const imageId = await insertImage(t, "scored", {
    scoreStatus: "unavailable",
    reason: UNAVAILABLE_REASON,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("images", imageId, { userId });
    await ctx.db.insert("scoringAttempts", {
      imageId,
      provider: "stub",
      outcome: "retryable_error",
      errorCode: "stub_retryable",
      latencyMs: 1,
      at: Date.now(),
    });
  });
  return imageId;
}

it("rescore: SCORING_UNAVAILABLE while both providers failed inside the outage window", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);
  const imageId = await insertOutageImage(t, userId);

  const error = await rejection(asUser.mutation(rescore, { id: imageId }));
  expect(error.data).toMatchObject({ code: "SCORING_UNAVAILABLE" });
  expect(await t.run(async (ctx) => ctx.db.get("images", imageId))).toMatchObject({
    status: "scored",
  });
});

it("rescore: an outage rejection does not consume the rescore allowance", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);

  // Repeated outage rejections spend nothing: they perform no provider work.
  for (let index = 0; index < 3; index += 1) {
    const imageId = await insertOutageImage(t, userId);
    const error = await rejection(asUser.mutation(rescore, { id: imageId }));
    expect(error.data).toMatchObject({ code: "SCORING_UNAVAILABLE" });
  }

  const images: Id<"images">[] = [];
  for (let index = 0; index < 10; index += 1) {
    const imageId = await insertImage(t, "scored", {
      scoreStatus: "unavailable",
      reason: UNAVAILABLE_REASON,
    });
    await t.run(async (ctx) => ctx.db.patch("images", imageId, { userId }));
    images.push(imageId);
  }
  for (const id of images) {
    await asUser.mutation(rescore, { id });
  }

  const tooMany = await insertImage(t, "scored", {
    scoreStatus: "unavailable",
    reason: UNAVAILABLE_REASON,
  });
  await t.run(async (ctx) => ctx.db.patch("images", tooMany, { userId }));
  const error = await rejection(asUser.mutation(rescore, { id: tooMany }));
  expect(error.data).toMatchObject({ code: "RATE_LIMITED" });
});

it("rescore: the rescore limit allows 10 an hour and denies the 11th", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);
  const images: Id<"images">[] = [];
  for (let index = 0; index < 11; index += 1) {
    const imageId = await insertImage(t, "scored", {
      scoreStatus: "unavailable",
      reason: UNAVAILABLE_REASON,
    });
    await t.run(async (ctx) => ctx.db.patch("images", imageId, { userId }));
    images.push(imageId);
  }

  for (const id of images.slice(0, 10)) {
    await asUser.mutation(rescore, { id });
  }
  const error = await rejection(asUser.mutation(rescore, { id: images[10]! }));
  expect(error.data).toMatchObject({ code: "RATE_LIMITED" });
  expect(
    error.data.detail?.retryAfterMs,
  ).toBeGreaterThan(0);
});

it("rescore force: calls the provider, replaces the cache entry, leaves other images on the old row", async () => {
  const t = harness();
  const { asUser, userId } = await signedIn(t);
  const sha256 = `61${"0".repeat(62)}`;

  const setup = await t.run(async (ctx) => {
    const oldScoreId = await ctx.db.insert("scores", {
      sha256,
      score: 10,
      confidence: 0.9,
      faceCount: 1,
      status: "scored",
      reason: "Scored",
      provider: "stub",
      providerModel: "stub-v1",
      configVersion: "1",
      latencyMs: 1,
      costMicros: 0,
      cacheable: true,
      createdAt: 1_700_000_000_000,
    });
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    );
    const imageId = await ctx.db.insert("images", {
      userId,
      sha256,
      storageId,
      mime: "image/webp",
      bytes: 3,
      status: "scored",
      scoreId: oldScoreId,
      scoreCached: true,
      createdAt: 1_700_000_000_000,
    });
    const otherId = await ctx.db.insert("images", {
      userId,
      sha256: "62".padEnd(64, "0"),
      storageId,
      mime: "image/webp",
      bytes: 3,
      status: "scored",
      scoreId: oldScoreId,
      scoreCached: true,
      createdAt: 1_700_000_000_001,
    });
    return { oldScoreId, imageId, otherId };
  });

  await asUser.mutation(rescore, { id: setup.imageId, force: true });
  // A stale non-forced job for the previous run must not short-circuit the
  // forced run (e.g. by serving the old cache entry).
  await t.action(score, { imageId: setup.imageId, run: 0 });
  await t.action(score, { imageId: setup.imageId, run: 1, force: true });

  const result = await t.run(async (ctx) => {
    const image = await ctx.db.get("images", setup.imageId);
    const other = await ctx.db.get("images", setup.otherId);
    const oldRow = await ctx.db.get("scores", setup.oldScoreId);
    const cacheHit = await ctx.db
      .query("scores")
      .withIndex("by_cache_entry", (q) =>
        q
          .eq("sha256", sha256)
          .eq("provider", "stub")
          .eq("configVersion", "1")
          .eq("cacheable", true),
      )
      .first();
    const attempts = await ctx.db
      .query("scoringAttempts")
      .withIndex("by_image_at", (q) => q.eq("imageId", setup.imageId))
      .collect();
    return { image, other, oldRow, cacheHit, attempts };
  });

  expect(result.attempts).toHaveLength(1);
  expect(result.attempts[0]?.outcome).toBe("success");
  expect(result.image?.status).toBe("scored");
  expect(result.image?.scoreId).toBeDefined();
  expect(result.image?.scoreId).not.toBe(setup.oldScoreId);
  expect(result.oldRow?.cacheable).toBe(false);
  expect(result.cacheHit?._id).toBe(result.image?.scoreId);
  // The other image still reads the score it was given.
  expect(result.other?.scoreId).toBe(setup.oldScoreId);
  expect(result.other?.status).toBe("scored");
});
