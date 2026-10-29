import type { ComponentApi } from "@convex-dev/better-auth/_generated/component.js";
import { register } from "@convex-dev/better-auth/test";
import { ARCHIVE_RETENTION_MS } from "@saycheese/core/limits";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, expect, it, vi } from "vitest";

import schema from "../convex/schema";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { ImageDto } from "../convex/model/images";

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;
type PaginationOpts = { numItems: number; cursor: string | null };
type Page = { page: ImageDto[]; isDone: boolean; continueCursor: string };
type SweepResult = {
  checked: number;
  purged: number;
  more: boolean;
};

const archive = makeFunctionReference<
  "mutation",
  { id: Id<"images"> },
  { id: Id<"images"> }
>("commands/images:archive");
const list = makeFunctionReference<
  "query",
  { paginationOpts: PaginationOpts },
  Page
>("queries/images:list");
const byId = makeFunctionReference<"query", { id: Id<"images"> }, ImageDto>(
  "queries/images:byId",
);
const fileUrl = makeFunctionReference<
  "query",
  { id: Id<"images">; variant: "original" | "preview" | "thumb" },
  { url: string | null }
>("queries/images:fileUrl");
const runSweep = makeFunctionReference<
  "mutation",
  { batchSize?: number },
  SweepResult
>("internal/archiveSweep:run");

const JPEG = "image/jpeg";

afterEach(() => {
  vi.useRealTimers();
});

async function rejection(
  promise: Promise<unknown>,
): Promise<ConvexError<{ code: string; message: string }>> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    return error as ConvexError<{ code: string; message: string }>;
  }
  throw new Error("Expected the call to reject");
}

async function createAccount(t: Test, component: ComponentApi, email: string) {
  const now = Date.now();
  const user = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "user",
        data: {
          name: email,
          email,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
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
          expiresAt: now + 60_000,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  return {
    user,
    asUser: t.withIdentity({ subject: user._id, sessionId: session._id }),
  };
}

async function signedIn(t: Test, email = "ada@example.test") {
  const component: ComponentApi = register(t, "betterAuth");
  return createAccount(t, component, email);
}

async function insertImage(
  t: Test,
  fields: {
    userId: string;
    status?: Doc<"images">["status"];
    archivedAt?: number;
    storage?: boolean;
    scoreId?: Id<"scores">;
  },
): Promise<{
  imageId: Id<"images">;
  storageIds: Id<"_storage">[];
}> {
  return t.run(async (ctx) => {
    const storageIds: Id<"_storage">[] = [];
    if (fields.storage ?? false) {
      for (let index = 0; index < 4; index += 1) {
        storageIds.push(
          await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
        );
      }
    }
    const imageId = await ctx.db.insert("images", {
      userId: fields.userId,
      sha256: "c".repeat(64),
      rawStorageId: storageIds[0],
      storageId: storageIds[1],
      previewId: storageIds[2],
      thumbId: storageIds[3],
      mime: JPEG,
      bytes: 3,
      width: 640,
      height: 480,
      status: fields.status ?? "scored",
      ...(fields.scoreId === undefined ? {} : { scoreId: fields.scoreId }),
      ...(fields.archivedAt === undefined
        ? {}
        : { archivedAt: fields.archivedAt }),
      createdAt: 1,
    });
    return { imageId, storageIds };
  });
}

async function audits(t: Test) {
  return t.run(async (ctx) => ctx.db.query("auditEvents").collect());
}

async function storageExists(t: Test, storageId: Id<"_storage">) {
  return t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null);
}

it("T-API-06 archives in one transaction with one audit row and hides the image", async () => {
  const t = convexTest(schema, modules);
  const { user, asUser } = await signedIn(t);
  const { imageId } = await insertImage(t, { userId: user._id, storage: true });

  await expect(asUser.mutation(archive, { id: imageId })).resolves.toEqual({
    id: imageId,
  });

  const row = await t.run(async (ctx) => ctx.db.get("images", imageId));
  expect(row?.archivedAt).toEqual(expect.any(Number));

  const events = await audits(t);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actorId: user._id,
    action: "image.archive",
    table: "images",
    docId: imageId,
    before: { status: "scored", archivedAt: null },
    after: { status: "scored", archivedAt: row?.archivedAt },
  });

  const page = await asUser.query(list, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page).toEqual([]);

  const viaById = await rejection(asUser.query(byId, { id: imageId }));
  const viaUrl = await rejection(
    asUser.query(fileUrl, { id: imageId, variant: "original" }),
  );
  expect(viaById.data).toMatchObject({ code: "NOT_FOUND" });
  expect(viaUrl.data).toEqual(viaById.data);
});

it("refuses a foreign image with NOT_FOUND and writes no audit row", async () => {
  const t = convexTest(schema, modules);
  const component: ComponentApi = register(t, "betterAuth");
  const { user: owner } = await createAccount(t, component, "owner@example.test");
  const { asUser: asForeign } = await createAccount(
    t,
    component,
    "foreign@example.test",
  );
  const { imageId } = await insertImage(t, { userId: owner._id });

  const error = await rejection(asForeign.mutation(archive, { id: imageId }));
  expect(error.data).toMatchObject({ code: "NOT_FOUND" });
  const row = await t.run(async (ctx) => ctx.db.get("images", imageId));
  expect(row?.archivedAt).toBeUndefined();
  expect(await audits(t)).toHaveLength(0);
});

it("refuses to archive an image the pipeline still holds", async () => {
  const t = convexTest(schema, modules);
  const { user, asUser } = await signedIn(t);
  const rows: Id<"images">[] = [];
  for (const status of ["uploaded", "processing", "scoring"] as const) {
    const { imageId } = await insertImage(t, {
      userId: user._id,
      status,
      storage: true,
    });
    rows.push(imageId);
  }

  for (const id of rows) {
    const error = await rejection(asUser.mutation(archive, { id }));
    expect(error.data).toMatchObject({ code: "VALIDATION_FAILED" });
  }

  for (const id of rows) {
    const row = await t.run(async (ctx) => ctx.db.get("images", id));
    expect(row?.archivedAt).toBeUndefined();
  }
  expect(await audits(t)).toHaveLength(0);
});

it("a second archive is NOT_FOUND and leaves the first audit row alone", async () => {
  const t = convexTest(schema, modules);
  const { user, asUser } = await signedIn(t);
  const { imageId } = await insertImage(t, { userId: user._id });

  await asUser.mutation(archive, { id: imageId });
  const second = await rejection(asUser.mutation(archive, { id: imageId }));

  expect(second.data).toMatchObject({ code: "NOT_FOUND" });
  expect(await audits(t)).toHaveLength(1);
});

it("deletes objects only after the retention window, keeps the row and shared data", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();
  const t = convexTest(schema, modules);
  const { user } = await signedIn(t);

  const scoreId = await t.run(async (ctx) =>
    ctx.db.insert("scores", {
      sha256: "a".repeat(64),
      score: 88,
      confidence: 0.9,
      faceCount: 1,
      status: "scored",
      reason: "Scored",
      provider: "stub",
      providerModel: "stub-v1",
      configVersion: "1",
      latencyMs: 1,
      cacheable: true,
      createdAt: start,
    }),
  );
  const archived = await insertImage(t, {
    userId: user._id,
    archivedAt: start,
    storage: true,
    scoreId,
  });
  const other = await insertImage(t, {
    userId: user._id,
    storage: true,
    scoreId,
  });

  const young = await t.mutation(runSweep, {});
  expect(young).toMatchObject({ checked: 0, purged: 0, more: false });
  for (const storageId of archived.storageIds) {
    expect(await storageExists(t, storageId)).toBe(true);
  }

  vi.setSystemTime(start + ARCHIVE_RETENTION_MS + 1);
  const result = await t.mutation(runSweep, {});
  expect(result).toMatchObject({ checked: 1, purged: 1, more: false });

  const row = await t.run(async (ctx) => ctx.db.get("images", archived.imageId));
  expect(row).not.toBeNull();
  expect(row).toMatchObject({
    archivedAt: start,
    purgedAt: expect.any(Number),
    scoreId,
  });
  expect(row?.storageId).toBeUndefined();
  expect(row?.previewId).toBeUndefined();
  expect(row?.thumbId).toBeUndefined();
  expect(row?.rawStorageId).toBeUndefined();
  for (const storageId of archived.storageIds) {
    expect(await storageExists(t, storageId)).toBe(false);
  }

  // The score row is shared with a live image and must survive untouched.
  expect(await t.run(async (ctx) => ctx.db.get("scores", scoreId))).not.toBeNull();
  const untouched = await t.run(async (ctx) =>
    ctx.db.get("images", other.imageId),
  );
  expect(untouched?.scoreId).toBe(scoreId);
  expect(untouched?.archivedAt).toBeUndefined();
  for (const storageId of other.storageIds) {
    expect(await storageExists(t, storageId)).toBe(true);
  }

  // A second run does not revisit the purged row: the index equality on the
  // missing `purgedAt` excludes it.
  const again = await t.mutation(runSweep, {});
  expect(again).toMatchObject({ checked: 0, purged: 0, more: false });
  expect(
    (await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    )).length,
  ).toBe(0);
});

it("marks an archived row that has no storage objects so it is not re-read", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();
  const t = convexTest(schema, modules);
  const { user } = await signedIn(t);
  const { imageId } = await insertImage(t, {
    userId: user._id,
    archivedAt: start - ARCHIVE_RETENTION_MS - 1,
    status: "failed",
  });

  const first = await t.mutation(runSweep, {});
  expect(first).toMatchObject({ checked: 1, purged: 0, more: false });
  expect(
    (await t.run(async (ctx) => ctx.db.get("images", imageId)))?.purgedAt,
  ).toEqual(expect.any(Number));

  expect(await t.mutation(runSweep, {})).toMatchObject({
    checked: 0,
    purged: 0,
    more: false,
  });
});

it("reschedules only while a full batch has work left", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();
  const t = convexTest(schema, modules);
  const { user } = await signedIn(t);
  // Both rows are strictly older than the cutoff (`lt`, not `lte`).
  const old = start - ARCHIVE_RETENTION_MS - 10;
  for (let index = 0; index < 2; index += 1) {
    await insertImage(t, {
      userId: user._id,
      archivedAt: old + index,
      storage: true,
    });
  }

  const first = await t.mutation(runSweep, { batchSize: 1 });
  expect(first).toMatchObject({ checked: 1, purged: 1, more: true });
  expect(
    (await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    )).length,
  ).toBe(1);

  // Each purged row leaves the index range, so the second batch finds the
  // other row rather than re-reading the first.
  const second = await t.mutation(runSweep, { batchSize: 1 });
  expect(second).toMatchObject({ checked: 1, purged: 1, more: true });

  // Nothing left: an empty batch makes no progress and schedules nothing.
  const third = await t.mutation(runSweep, { batchSize: 1 });
  expect(third).toMatchObject({ checked: 0, purged: 0, more: false });
  expect(
    (await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    )).length,
  ).toBe(2);
});
