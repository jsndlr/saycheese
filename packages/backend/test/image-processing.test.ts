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
  expect((await imageRow(t, imageId))?.status).toBe("processing");

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

it("markFailed only moves processing -> failed and records the code", async () => {
  const t = convexTest(schema, modules);
  const { imageId } = await uploadedImage(t);

  // Not claimed yet: a stale action cannot fail an untouched upload.
  expect(await t.mutation(markFailed, { imageId, code: "IMAGE_CORRUPT" })).toBe(false);
  expect((await imageRow(t, imageId))?.status).toBe("uploaded");

  await t.mutation(claimForProcessing, { imageId });
  expect(
    await t.mutation(markFailed, { imageId, code: "UNSUPPORTED_MEDIA_TYPE" }),
  ).toBe(true);
  expect(await imageRow(t, imageId)).toMatchObject({
    status: "failed",
    failureCode: "UNSUPPORTED_MEDIA_TYPE",
  });

  // A duplicate failure cannot rewrite the recorded code.
  expect(await t.mutation(markFailed, { imageId, code: "IMAGE_CORRUPT" })).toBe(false);
  expect((await imageRow(t, imageId))?.failureCode).toBe("UNSUPPORTED_MEDIA_TYPE");
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