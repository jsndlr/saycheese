import type { ComponentApi } from "@convex-dev/better-auth/_generated/component.js";
import { register } from "@convex-dev/better-auth/test";
import {
  UPLOAD_COMMIT_GRACE_MS,
  UPLOAD_URL_TTL_MS,
} from "@saycheese/core/limits";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it, vi } from "vitest";

import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import type { SeedImageRow } from "../convex/internal/seedData";
import { SEED_IMAGES } from "../convex/model/seed";

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;
type Component = ComponentApi;

type SweepResult = {
  checked: number;
  deleted: number;
  watermark: number;
  more: boolean;
};

const runSweep = makeFunctionReference<
  "mutation",
  { batchSize?: number },
  SweepResult
>("internal/storageSweep:run");

const seedCommit = makeFunctionReference<
  "mutation",
  {
    userId: string;
    images: SeedImageRow[];
  },
  { imagesCreated: number; imagesSkipped: number; unusedStorageIds: Id<"_storage">[] }
>("internal/seedData:commit");

const encoder = new TextEncoder();
const CUTOFF_MS = UPLOAD_URL_TTL_MS + UPLOAD_COMMIT_GRACE_MS;
const SPACING_MS = 3 * 60_000;

/** Stores a blob whose `_creationTime` is `ageMs` in the past. */
async function storeAged(
  t: Test,
  ageMs: number,
  label: string,
): Promise<Id<"_storage">> {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() - ageMs);
    return await t.run(async (ctx) =>
      ctx.storage.store(new Blob([encoder.encode(`sweep-fixture-${label}`)])),
    );
  } finally {
    vi.useRealTimers();
  }
}

async function storageExists(t: Test, storageId: Id<"_storage">) {
  return t.run(async (ctx) => (await ctx.db.system.get(storageId)) !== null);
}

async function creationTime(t: Test, storageId: Id<"_storage">) {
  return t.run(async (ctx) => (await ctx.db.system.get(storageId))?._creationTime);
}

async function watermark(t: Test) {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("maintenance")
      .withIndex("by_key", (q) => q.eq("key", "storageSweep"))
      .first();
    return row?.watermark;
  });
}

async function createAccount(t: Test, component: Component, email: string) {
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
  return user;
}

it("deletes an orphan older than the upload cutoff", async () => {
  const t = convexTest(schema, modules);
  const orphan = await storeAged(t, CUTOFF_MS + 60_000, "old-orphan");

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({ checked: 1, deleted: 1, more: false });
  expect(await storageExists(t, orphan)).toBe(false);
});

it("keeps an orphan younger than the cutoff, which may still commit", async () => {
  const t = convexTest(schema, modules);
  const inFlight = await storeAged(t, 60_000, "in-flight");

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({ checked: 0, deleted: 0, more: false });
  expect(await storageExists(t, inFlight)).toBe(true);
});

it("keeps referenced raw uploads and every processed variant, however old", async () => {
  const t = convexTest(schema, modules);
  const age = CUTOFF_MS + 24 * 60 * 60_000;
  const rawStorageId = await storeAged(t, age, "raw");
  const storageId = await storeAged(t, age, "large");
  const previewId = await storeAged(t, age, "preview");
  const thumbId = await storeAged(t, age, "thumb");

  await t.run(async (ctx) =>
    ctx.db.insert("images", {
      userId: "user-1",
      sha256: "a".repeat(64),
      rawStorageId,
      storageId,
      previewId,
      thumbId,
      mime: "image/jpeg",
      bytes: 1,
      status: "ready",
      createdAt: Date.now(),
    }),
  );

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({ checked: 4, deleted: 0, more: false });
  for (const ownedId of [rawStorageId, storageId, previewId, thumbId]) {
    expect(await storageExists(t, ownedId)).toBe(true);
  }
});

it("never deletes the objects referenced by seeded images", async () => {
  const t = convexTest(schema, modules);
  const component = register(t, "betterAuth");
  const user = await createAccount(t, component, "demo@saycheese.dev");

  const plans: SeedImageRow[] = [];
  for (const [index, spec] of SEED_IMAGES.entries()) {
    const plan: SeedImageRow = {
      sha256: index.toString(16).padStart(64, "0"),
      mime: "image/png",
      bytes: 64 + index,
      width: 1200,
      height: 900,
      status: spec.status,
      failureCode: spec.failureCode,
      createdAt: Date.now() - index * SPACING_MS,
      score: spec.score,
    };
    if (spec.hasVariants) {
      plan.storageId = await storeAged(t, CUTOFF_MS + 60_000, `${index}-large`);
      plan.previewId = await storeAged(t, CUTOFF_MS + 60_000, `${index}-medium`);
      plan.thumbId = await storeAged(t, CUTOFF_MS + 60_000, `${index}-thumb`);
    } else {
      plan.rawStorageId = await storeAged(t, CUTOFF_MS + 60_000, `${index}-raw`);
    }
    plans.push(plan);
  }

  const committed = await t.mutation(seedCommit, { userId: user._id, images: plans });
  expect(committed.imagesCreated).toBe(5);

  const seededIds = plans.flatMap((plan) =>
    [plan.rawStorageId, plan.storageId, plan.previewId, plan.thumbId].filter(
      (id): id is Id<"_storage"> => id !== undefined,
    ),
  );
  expect(seededIds).toHaveLength(11);

  const result = await t.mutation(runSweep, {});

  expect(result).toMatchObject({ checked: 11, deleted: 0, more: false });
  for (const storageId of seededIds) {
    expect(await storageExists(t, storageId)).toBe(true);
  }
});

it("advances the watermark, so the next run checks nothing", async () => {
  const t = convexTest(schema, modules);
  const orphan = await storeAged(t, CUTOFF_MS + 60_000, "orphan");
  const orphanCreatedAt = await creationTime(t, orphan);

  const first = await t.mutation(runSweep, {});
  expect(first).toMatchObject({ checked: 1, deleted: 1, more: false });
  expect(await watermark(t)).toBe(orphanCreatedAt);

  const second = await t.mutation(runSweep, {});
  expect(second).toEqual({
    checked: 0,
    deleted: 0,
    watermark: orphanCreatedAt,
    more: false,
  });
});

it("sweeps more objects than one batch by scheduling the next batch", async () => {
  const t = convexTest(schema, modules);
  const orphans: Id<"_storage">[] = [];
  for (let index = 0; index < 5; index += 1) {
    orphans.push(
      await storeAged(t, CUTOFF_MS + 60_000 + index * 1_000, `batched-${index}`),
    );
  }

  const lastOrphanCreatedAt = (await creationTime(t, orphans[0]!))!;

  const first = await t.mutation(runSweep, { batchSize: 2 });
  expect(first).toMatchObject({ checked: 2, deleted: 2, more: true });

  const scheduled = await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(scheduled.map((job) => job.name)).toEqual(["internal/storageSweep:run"]);

  await t.finishAllScheduledFunctions(() => {});

  for (const storageId of orphans) {
    expect(await storageExists(t, storageId)).toBe(false);
  }

  const finalWatermark = await watermark(t);
  expect(finalWatermark).toBeGreaterThanOrEqual(lastOrphanCreatedAt);
  expect(finalWatermark).toBeGreaterThan(first.watermark);
});