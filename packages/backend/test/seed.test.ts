import type { ComponentApi } from "@convex-dev/better-auth/_generated/component.js";
import { register } from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";

import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import type { SeedImageRow } from "../convex/internal/seedData";
import { isStorageIdReferenced } from "../convex/lib/storage";
import { assertSeedDeployment } from "../convex/lib/seedGuard";
import { SEED_IMAGES } from "../convex/model/seed";
import type { ImageDto } from "../convex/model/images";

/**
 * The Node seed action needs sharp and `node:crypto`, so it cannot run in the
 * edge runtime. These tests cover the guard plus the mutation half with
 * pre-stored fixture blobs instead of rendered PNGs.
 */

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;
type Component = ComponentApi;

type CommitResult = {
  imagesCreated: number;
  imagesSkipped: number;
  unusedStorageIds: Id<"_storage">[];
};

type Page = { page: ImageDto[]; isDone: boolean; continueCursor: string };

const commit = makeFunctionReference<
  "mutation",
  { userId: string; images: SeedImageRow[] },
  CommitResult
>("internal/seedData:commit");

const list = makeFunctionReference<
  "query",
  { paginationOpts: { numItems: number; cursor: string | null } },
  Page
>("queries/images:list");

const encoder = new TextEncoder();
const SPACING_MS = 3 * 60_000;

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
  return { user, asUser: t.withIdentity({ subject: user._id, sessionId: session._id }) };
}

async function store(t: Test, label: string): Promise<Id<"_storage">> {
  return t.run(async (ctx) =>
    ctx.storage.store(new Blob([encoder.encode(`seed-fixture-${label}`)])),
  );
}

async function fixturePlans(t: Test, base: number): Promise<SeedImageRow[]> {
  const plans: SeedImageRow[] = [];
  for (const [index, spec] of SEED_IMAGES.entries()) {
    const sha256 = index.toString(16).padStart(64, "0");
    const plan: SeedImageRow = {
      sha256,
      mime: "image/png",
      bytes: 64 + index,
      width: 1200,
      height: 900,
      status: spec.status,
      failureCode: spec.failureCode,
      createdAt: base - index * SPACING_MS,
      score: spec.score,
    };
    if (spec.hasVariants) {
      plan.storageId = await store(t, `${index}-large`);
      plan.previewId = await store(t, `${index}-medium`);
      plan.thumbId = await store(t, `${index}-thumb`);
    } else {
      plan.rawStorageId = await store(t, `${index}-raw`);
    }
    plans.push(plan);
  }
  return plans;
}

it("refuses every SITE_URL that is not a localhost dev deployment", () => {
  expect(() => assertSeedDeployment("https://saycheese.vercel.app")).toThrow(
    /Refusing to seed/,
  );
  expect(() => assertSeedDeployment("https://localhost:3001")).toThrow(
    /Refusing to seed/,
  );
  expect(() => assertSeedDeployment("http://localhost.example.com")).toThrow(
    /Refusing to seed/,
  );
  expect(() => assertSeedDeployment("not a url")).toThrow(/Refusing to seed/);

  expect(() => assertSeedDeployment("http://localhost:3001")).not.toThrow();
  expect(() => assertSeedDeployment("http://127.0.0.1:3001")).not.toThrow();
});

it("writes the five demo images and three score rows, all storage referenced", async () => {
  const t = convexTest(schema, modules);
  const component = register(t, "betterAuth");
  const { user, asUser } = await createAccount(t, component, "demo@saycheese.dev");
  const base = Date.now();
  const plans = await fixturePlans(t, base);

  const result = await t.mutation(commit, { userId: user._id, images: plans });

  expect(result).toEqual({ imagesCreated: 5, imagesSkipped: 0, unusedStorageIds: [] });

  const rows = await t.run(async (ctx) => ({
    images: await ctx.db.query("images").collect(),
    scores: await ctx.db.query("scores").collect(),
  }));

  expect(rows.images).toHaveLength(5);
  expect(rows.scores).toHaveLength(3);
  expect(rows.images.every((image) => image.userId === user._id)).toBe(true);

  const statuses = rows.images
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((image) => [image.status, image.failureCode ?? null]);
  expect(statuses).toEqual([
    ["failed", "IMAGE_CORRUPT"],
    ["uploaded", null],
    ["scored", null],
    ["scored", null],
    ["scored", null],
  ]);

  const scoreStatuses = rows.scores.map((score) => score.status).sort();
  expect(scoreStatuses).toEqual(["multiple_faces", "no_face", "scored"]);
  for (const score of rows.scores) {
    expect(score).toMatchObject({
      provider: "stub",
      providerModel: "stub-v1",
      configVersion: "1",
    });
  }
  expect(rows.scores.find((score) => score.status === "scored")?.score).toBe(82);
  expect(rows.scores.find((score) => score.status === "no_face")?.score).toBeNull();

  const scoredImages = rows.images.filter((image) => image.status === "scored");
  expect(scoredImages).toHaveLength(3);
  for (const image of scoredImages) {
    expect(image.scoreId).toBeDefined();
    expect(rows.scores.some((score) => score._id === image.scoreId)).toBe(true);
    expect(image.storageId).toBeDefined();
    expect(image.previewId).toBeDefined();
    expect(image.thumbId).toBeDefined();
    expect(image.rawStorageId).toBeUndefined();
  }

  const storedIds = plans.flatMap((plan) =>
    [plan.rawStorageId, plan.storageId, plan.previewId, plan.thumbId].filter(
      (id): id is Id<"_storage"> => id !== undefined,
    ),
  );
  await t.run(async (ctx) => {
    for (const storageId of storedIds) {
      await expect(isStorageIdReferenced(ctx, storageId)).resolves.toBe(true);
    }
  });

  const page = await asUser.query(list, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((image) => image.status)).toEqual([
    "scored",
    "scored",
    "scored",
    "uploaded",
    "failed",
  ]);
  expect(page.page.map((image) => image.createdAt)).toEqual(
    [...page.page.map((image) => image.createdAt)].sort((a, b) => b - a),
  );
});

it("is a no-op on the second run and reports objects it did not use", async () => {
  const t = convexTest(schema, modules);
  const component = register(t, "betterAuth");
  const { user } = await createAccount(t, component, "demo@saycheese.dev");
  const base = Date.now();
  const plans = await fixturePlans(t, base);

  await t.mutation(commit, { userId: user._id, images: plans });

  const second = await t.mutation(commit, { userId: user._id, images: plans });

  expect(second).toEqual({ imagesCreated: 0, imagesSkipped: 5, unusedStorageIds: [] });

  const counts = await t.run(async (ctx) => ({
    images: (await ctx.db.query("images").collect()).length,
    scores: (await ctx.db.query("scores").collect()).length,
  }));
  expect(counts).toEqual({ images: 5, scores: 3 });

  // An object stored for a row that already exists is reported for deletion,
  // and an object already referenced by a row never is.
  const orphan = await store(t, "orphan");
  const raced = await t.mutation(commit, {
    userId: user._id,
    images: [{ ...plans[3], rawStorageId: orphan }],
  });
  expect(raced.imagesCreated).toBe(0);
  expect(raced.imagesSkipped).toBe(1);
  expect(raced.unusedStorageIds).toEqual([orphan]);
});