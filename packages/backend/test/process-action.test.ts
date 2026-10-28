import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import sharp from "sharp";
import { expect, it, vi } from "vitest";

import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

/**
 * The process action runs in the Node runtime because it needs sharp. This test
 * exercises the catch-all seam: validation throwing an unexpected exception
 * (not returning a typed failure) must still end in `failed`/`INTERNAL`
 * instead of leaving the row in `processing`.
 */

const modules = import.meta.glob("../convex/**/*.ts");

vi.mock("../convex/lib/imageValidation", () => ({
  validateImage: async () => {
    throw new Error("sharp exploded");
  },
}));

const process = makeFunctionReference<
  "action",
  { imageId: Id<"images"> },
  void
>("actions/images:process");

async function pngFixture(): Promise<Buffer> {
  return await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();
}

it("fails the row with INTERNAL when the post-claim pipeline throws", async () => {
  const t = convexTest(schema, modules);
  const png = await pngFixture();

  const { imageId, rawStorageId } = await t.run(async (ctx) => {
    const rawStorageId = await ctx.storage.store(
      new Blob([new Uint8Array(png)], { type: "image/png" }),
    );
    const imageId = await ctx.db.insert("images", {
      userId: "user-1",
      sha256: "a".repeat(64),
      rawStorageId,
      mime: "image/png",
      bytes: png.length,
      status: "uploaded",
      createdAt: Date.now(),
    });
    return { imageId, rawStorageId };
  });

  await t.action(process, { imageId });

  expect(await t.run(async (ctx) => ctx.db.get("images", imageId))).toMatchObject({
    status: "failed",
    failureCode: "INTERNAL",
  });
  expect(await t.run(async (ctx) => ctx.storage.get(rawStorageId))).toBeNull();
});