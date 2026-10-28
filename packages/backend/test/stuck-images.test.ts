import { PROCESSING_TIMEOUT_MS } from "@saycheese/core/limits";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";

import schema from "../convex/schema";
import type { Doc, Id } from "../convex/_generated/dataModel";

/**
 * The stuck sweep is the backstop for a lost process action: a row that stays
 * `processing` past the Node action cap, or an `uploaded` row whose scheduled
 * action never ran, is failed with IMAGE_TIMEOUT and its objects are released.
 */

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;

type SweepResult = {
  processingChecked: number;
  processingFailed: number;
  uploadedChecked: number;
  uploadedFailed: number;
  more: boolean;
};

const runSweep = makeFunctionReference<
  "mutation",
  { batchSize?: number },
  SweepResult
>("internal/stuckImages:run");

const OLD_MS = PROCESSING_TIMEOUT_MS + 60_000;
const YOUNG_MS = PROCESSING_TIMEOUT_MS - 60_000;

async function insertImage(
  t: Test,
  fields: {
    status: Doc<"images">["status"];
    createdAt: number;
    processingStartedAt?: number;
    storage?: boolean;
    storageMissing?: boolean;
  },
) {
  return t.run(async (ctx) => {
    const storageIds: Id<"_storage">[] = [];
    if (fields.storage ?? true) {
      const count =
        fields.status === "ready" || fields.status === "scoring" ? 3 : 1;
      for (let index = 0; index < count; index += 1) {
        storageIds.push(
          await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
        );
      }
    }
    if (fields.storageMissing && storageIds[0] !== undefined) {
      // Keep the id on the row but remove the object: the failure path must
      // tolerate a reference whose bytes are already gone.
      await ctx.storage.delete(storageIds[0]);
    }
    const imageId = await ctx.db.insert("images", {
      userId: "user-1",
      sha256: "c".repeat(64),
      rawStorageId: storageIds[0],
      storageId: fields.status === "ready" ? storageIds[1] : undefined,
      mime: "image/jpeg",
      bytes: 3,
      status: fields.status,
      processingStartedAt: fields.processingStartedAt,
      createdAt: fields.createdAt,
    });
    return { imageId, storageIds };
  });
}

async function imageRow(t: Test, imageId: Id<"images">) {
  return t.run(async (ctx) => ctx.db.get("images", imageId));
}

async function storageExists(t: Test, storageId: Id<"_storage">) {
  return t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null);
}

async function audits(t: Test) {
  return t.run(async (ctx) => ctx.db.query("auditEvents").collect());
}

it("fails a processing row older than the timeout and deletes its objects", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { imageId, storageIds } = await insertImage(t, {
    status: "processing",
    createdAt: now - OLD_MS,
    processingStartedAt: now - OLD_MS,
  });

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({
    processingChecked: 1,
    processingFailed: 1,
    uploadedChecked: 0,
    uploadedFailed: 0,
    more: false,
  });
  const row = await imageRow(t, imageId);
  expect(row).toMatchObject({ status: "failed", failureCode: "IMAGE_TIMEOUT" });
  expect(row?.rawStorageId).toBeUndefined();
  for (const storageId of storageIds) {
    expect(await storageExists(t, storageId)).toBe(false);
  }

  const events = await audits(t);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actorId: "system:process",
    action: "image.fail",
    docId: imageId,
    before: { status: "processing" },
    after: { status: "failed", failureCode: "IMAGE_TIMEOUT" },
  });
});

it("leaves a processing row younger than the timeout alone", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { imageId, storageIds } = await insertImage(t, {
    status: "processing",
    createdAt: now - YOUNG_MS,
    processingStartedAt: now - YOUNG_MS,
  });
  const before = await imageRow(t, imageId);

  const result = await t.mutation(runSweep, {});

  expect(result.processingChecked).toBe(0);
  expect(await imageRow(t, imageId)).toEqual(before);
  for (const storageId of storageIds) {
    expect(await storageExists(t, storageId)).toBe(true);
  }
  expect(await audits(t)).toHaveLength(0);
});

it("never fails a timestamp-less processing row, however old", async () => {
  const t = convexTest(schema, modules);
  const { imageId, storageIds } = await insertImage(t, {
    status: "processing",
    createdAt: Date.now() - OLD_MS,
  });
  const before = await imageRow(t, imageId);

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({
    processingChecked: 0,
    processingFailed: 0,
    more: false,
  });
  expect(await imageRow(t, imageId)).toEqual(before);
  expect(await storageExists(t, storageIds[0]!)).toBe(true);
  expect(await audits(t)).toHaveLength(0);
});

it("does not schedule a continuation when no rows are due", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  // Too young for the numeric range, so these rows are never even selected;
  // a "full batch" of them cannot occur. The sweep must make no progress and
  // must not reschedule itself.
  for (let index = 0; index < 2; index += 1) {
    await insertImage(t, {
      status: "processing",
      createdAt: now - YOUNG_MS,
      processingStartedAt: now - YOUNG_MS,
    });
  }

  const result = await t.mutation(runSweep, { batchSize: 2 });

  expect(result).toMatchObject({
    processingChecked: 0,
    processingFailed: 0,
    more: false,
  });
  expect(
    await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).length,
    ),
  ).toBe(0);
});

it("fails an old uploaded row whose process action never ran", async () => {
  const t = convexTest(schema, modules);
  const { imageId, storageIds } = await insertImage(t, {
    status: "uploaded",
    createdAt: Date.now() - OLD_MS,
  });

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({ uploadedChecked: 1, uploadedFailed: 1 });
  expect(await imageRow(t, imageId)).toMatchObject({
    status: "failed",
    failureCode: "IMAGE_TIMEOUT",
  });
  expect(await storageExists(t, storageIds[0]!)).toBe(false);
  expect((await audits(t))[0]).toMatchObject({
    before: { status: "uploaded" },
    after: { status: "failed", failureCode: "IMAGE_TIMEOUT" },
  });
});

it("never touches ready, scoring or scored rows, however old", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const ready = await insertImage(t, {
    status: "ready",
    createdAt: now - OLD_MS,
    processingStartedAt: now - OLD_MS,
  });
  const scoring = await insertImage(t, {
    status: "scoring",
    createdAt: now - OLD_MS,
    processingStartedAt: now - OLD_MS,
  });
  const scored = await insertImage(t, {
    status: "scored",
    createdAt: now - OLD_MS,
    processingStartedAt: now - OLD_MS,
  });
  const readyBefore = await imageRow(t, ready.imageId);
  const scoringBefore = await imageRow(t, scoring.imageId);
  const scoredBefore = await imageRow(t, scored.imageId);

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({
    processingChecked: 0,
    uploadedChecked: 0,
    more: false,
  });
  expect(await imageRow(t, ready.imageId)).toEqual(readyBefore);
  expect(await imageRow(t, scoring.imageId)).toEqual(scoringBefore);
  expect(await imageRow(t, scored.imageId)).toEqual(scoredBefore);
  for (const storageId of [
    ...ready.storageIds,
    ...scoring.storageIds,
    ...scored.storageIds,
  ]) {
    expect(await storageExists(t, storageId)).toBe(true);
  }
  expect(await audits(t)).toHaveLength(0);
});

it("fails every row in a batch even when one object is already gone", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const old = now - OLD_MS;
  const rows = [
    await insertImage(t, {
      status: "processing",
      createdAt: old,
      processingStartedAt: old,
    }),
    await insertImage(t, {
      status: "processing",
      createdAt: old,
      processingStartedAt: old,
      storageMissing: true,
    }),
    await insertImage(t, {
      status: "processing",
      createdAt: old,
      processingStartedAt: old,
    }),
  ];

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({
    processingChecked: 3,
    processingFailed: 3,
    more: false,
  });
  for (const { imageId } of rows) {
    expect(await imageRow(t, imageId)).toMatchObject({
      status: "failed",
      failureCode: "IMAGE_TIMEOUT",
    });
  }
  const events = await audits(t);
  expect(events).toHaveLength(3);
  expect(events.every((event) => event.action === "image.fail")).toBe(true);
});

it("schedules the next batch when one fills", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const old = now - OLD_MS;
  const first = await insertImage(t, {
    status: "processing",
    createdAt: old,
    processingStartedAt: old,
  });
  const second = await insertImage(t, {
    status: "processing",
    createdAt: old + 1_000,
    processingStartedAt: old + 1_000,
  });

  const run = await t.mutation(runSweep, { batchSize: 1 });

  expect(run).toMatchObject({ processingChecked: 1, more: true });
  expect(
    await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).map(
        (job) => job.name,
      ),
    ),
  ).toEqual(["internal/stuckImages:run"]);

  await t.finishAllScheduledFunctions(() => {});

  for (const { imageId } of [first, second]) {
    expect(await imageRow(t, imageId)).toMatchObject({
      status: "failed",
      failureCode: "IMAGE_TIMEOUT",
    });
  }
});