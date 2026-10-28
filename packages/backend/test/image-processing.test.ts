import type { ErrorCode } from "@saycheese/core/errors";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";

import type { Doc, Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

/**
 * The process action itself imports sharp and therefore cannot run in the edge
 * runtime. These tests cover the mutation half: claim idempotency and the
 * `processing -> failed` transition.
 */

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;
type Claim = { rawStorageId: Id<"_storage">; mime: string } | null;

const claimForProcessing = makeFunctionReference<
  "mutation",
  { imageId: Id<"images"> },
  Claim
>("internal/images:claimForProcessing");

const markFailed = makeFunctionReference<
  "mutation",
  { imageId: Id<"images">; code: ErrorCode },
  boolean
>("internal/images:markFailed");

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

async function uploadedImage(
  t: Test,
  status: Doc<"images">["status"] = "uploaded",
) {
  return t.run(async (ctx) => {
    const rawStorageId = await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])]));
    const imageId = await ctx.db.insert("images", {
      userId: "user-1",
      sha256: "a".repeat(64),
      rawStorageId,
      mime: "image/jpeg",
      bytes: 3,
      status,
      createdAt: 1_700_000_000_000,
    });
    return { imageId, rawStorageId };
  });
}

async function imageRow(t: Test, imageId: Id<"images">) {
  return t.run(async (ctx) => ctx.db.get("images", imageId));
}

it("claimForProcessing moves uploaded -> processing exactly once", async () => {
  const t = convexTest(schema, modules);
  const { imageId, rawStorageId } = await uploadedImage(t);

  const first = await t.mutation(claimForProcessing, { imageId });
  expect(first).toEqual({ rawStorageId, mime: "image/jpeg" });
  expect(await imageRow(t, imageId)).toMatchObject({
    status: "processing",
    processingStartedAt: expect.any(Number),
  });

  // A duplicate scheduler run or a retry must not restart the job.
  expect(await t.mutation(claimForProcessing, { imageId })).toBeNull();
  expect((await imageRow(t, imageId))?.status).toBe("processing");
});

it("claimForProcessing leaves non-uploaded rows alone", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await uploadedImage(t, "ready");

  expect(await t.mutation(claimForProcessing, { imageId })).toBeNull();
  expect((await imageRow(t, imageId))?.status).toBe("ready");
});

it("markFailed only moves uploaded/processing -> failed and records the code", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await uploadedImage(t);

  // The stuck sweep fails an upload whose process action never started.
  expect(await t.mutation(markFailed, { imageId, code: "IMAGE_TIMEOUT" })).toBe(true);
  expect(await imageRow(t, imageId)).toMatchObject({
    status: "failed",
    failureCode: "IMAGE_TIMEOUT",
  });

  const claimed = await uploadedImage(t);
  await t.mutation(claimForProcessing, { imageId: claimed.imageId });
  expect(
    await t.mutation(markFailed, {
      imageId: claimed.imageId,
      code: "UNSUPPORTED_MEDIA_TYPE",
    }),
  ).toBe(true);
  expect(await imageRow(t, claimed.imageId)).toMatchObject({
    status: "failed",
    failureCode: "UNSUPPORTED_MEDIA_TYPE",
  });

  // A duplicate failure cannot rewrite the recorded code.
  expect(
    await t.mutation(markFailed, { imageId: claimed.imageId, code: "IMAGE_CORRUPT" }),
  ).toBe(false);
  expect((await imageRow(t, claimed.imageId))?.failureCode).toBe(
    "UNSUPPORTED_MEDIA_TYPE",
  );
});

it("T-SEC-02 deletes every referenced object and writes one audit row", async () => {
  const t = convexTest(schema, modules);
  const { imageId, storageIds } = await t.run(async (ctx) => {
    const store = () =>
      ctx.storage.store(new Blob([new Uint8Array([7, 8, 9])]));
    const [rawStorageId, storageId, previewId, thumbId] = await Promise.all([
      store(),
      store(),
      store(),
      store(),
    ]);
    const imageId = await ctx.db.insert("images", {
      userId: "user-1",
      sha256: "b".repeat(64),
      rawStorageId,
      storageId,
      previewId,
      thumbId,
      mime: "image/jpeg",
      bytes: 3,
      status: "processing",
      processingStartedAt: Date.now(),
      createdAt: 1_700_000_000_000,
    });
    return {
      imageId,
      storageIds: [rawStorageId, storageId, previewId, thumbId],
    };
  });

  expect(await t.mutation(markFailed, { imageId, code: "IMAGE_CORRUPT" })).toBe(true);

  expect(await imageRow(t, imageId)).toMatchObject({
    status: "failed",
    failureCode: "IMAGE_CORRUPT",
  });
  const row = await imageRow(t, imageId);
  expect(row?.rawStorageId).toBeUndefined();
  expect(row?.storageId).toBeUndefined();
  expect(row?.previewId).toBeUndefined();
  expect(row?.thumbId).toBeUndefined();

  await t.run(async (ctx) => {
    for (const storageId of storageIds) {
      expect(await ctx.storage.get(storageId)).toBeNull();
    }
  });

  const audits = await t.run(async (ctx) =>
    ctx.db.query("auditEvents").collect(),
  );
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actorId: "system:process",
    action: "image.fail",
    table: "images",
    docId: imageId,
    before: { status: "processing" },
    after: { status: "failed", failureCode: "IMAGE_CORRUPT" },
  });
  expect(audits[0]?.at).toEqual(expect.any(Number));
});

it("T-SEC-02 fails a row whose raw object is already gone", async () => {
  const t = convexTest(schema, modules);
  const { imageId, rawStorageId } = await t.run(async (ctx) => {
    const rawStorageId = await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])]),
    );
    const imageId = await ctx.db.insert("images", {
      userId: "user-1",
      sha256: "c".repeat(64),
      rawStorageId,
      mime: "image/jpeg",
      bytes: 3,
      status: "processing",
      processingStartedAt: Date.now(),
      createdAt: 1_700_000_000_000,
    });
    // Another transaction (the orphan sweep, a crash) already removed it.
    await ctx.storage.delete(rawStorageId);
    return { imageId, rawStorageId };
  });

  expect(await t.mutation(markFailed, { imageId, code: "IMAGE_CORRUPT" })).toBe(true);

  expect(await imageRow(t, imageId)).toMatchObject({
    status: "failed",
    failureCode: "IMAGE_CORRUPT",
  });
  expect(await t.run(async (ctx) => ctx.storage.get(rawStorageId))).toBeNull();
  const audits = await t.run(async (ctx) =>
    ctx.db.query("auditEvents").collect(),
  );
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ action: "image.fail", docId: imageId });
});

it("T-SEC-02 markFailed leaves a ready row and its objects untouched", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await uploadedImage(t, "ready");
  const before = await imageRow(t, imageId);

  expect(await t.mutation(markFailed, { imageId, code: "IMAGE_CORRUPT" })).toBe(false);
  expect(await imageRow(t, imageId)).toEqual(before);
  expect(
    await t.run(async (ctx) =>
      (await ctx.storage.get(before!.rawStorageId!)) !== null,
    ),
  ).toBe(true);
  expect(
    await t.run(async (ctx) => (await ctx.db.query("auditEvents").collect()).length),
  ).toBe(0);
});

async function readyArgs(
  t: Test,
  imageId: Id<"images">,
): Promise<MarkReadyArgs> {
  return t.run(async (ctx) => {
    const [storageId, previewId, thumbId] = await Promise.all([
      ctx.storage.store(new Blob([new Uint8Array([4])])),
      ctx.storage.store(new Blob([new Uint8Array([5])])),
      ctx.storage.store(new Blob([new Uint8Array([6])])),
    ]);
    return { imageId, storageId, previewId, thumbId, width: 1600, height: 1067 };
  });
}

it("markReady publishes variants, dimensions and deletes the raw object", async () => {
  const t = convexTest(schema, modules);
  const { imageId, rawStorageId } = await uploadedImage(t, "processing");
  const args = await readyArgs(t, imageId);

  expect(await t.mutation(markReady, args)).toBe(true);
  expect(await imageRow(t, imageId)).toMatchObject({
    status: "ready",
    storageId: args.storageId,
    previewId: args.previewId,
    thumbId: args.thumbId,
    width: 1600,
    height: 1067,
  });
  expect((await imageRow(t, imageId))?.rawStorageId).toBeUndefined();

  // The raw upload is retired in the same transaction, not just unlinked.
  expect(
    await t.run(async (ctx) => await ctx.storage.get(rawStorageId)),
  ).toBeNull();
  for (const id of [args.storageId, args.previewId, args.thumbId]) {
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(id)) !== null),
    ).toBe(true);
  }
});

it("markReady leaves a row outside processing untouched", async () => {
  for (const status of ["uploaded", "ready", "failed"] as const) {
    const t = convexTest(schema, modules);
    const { imageId, rawStorageId } = await uploadedImage(t, status);
    const before = await imageRow(t, imageId);
    const args = await readyArgs(t, imageId);

    expect(await t.mutation(markReady, args)).toBe(false);
    expect(await imageRow(t, imageId)).toEqual(before);
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(rawStorageId)) !== null),
    ).toBe(true);
    // The caller owns cleanup of the three objects it stored.
    for (const id of [args.storageId, args.previewId, args.thumbId]) {
      expect(
        await t.run(async (ctx) => (await ctx.storage.get(id)) !== null),
      ).toBe(true);
    }
  }
});