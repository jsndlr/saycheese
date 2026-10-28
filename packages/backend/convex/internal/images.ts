import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { errorCode } from "../validators";

/**
 * Mutation half of the process action. Kept free of sharp so it can run in the
 * default Convex runtime and be exercised by the edge tests.
 */

/**
 * Moves an image `uploaded -> processing` exactly once and hands the raw object
 * to the caller. A duplicate scheduled run or a retry sees a status other than
 * `uploaded` and gets `null`, so it does nothing.
 */
export const claimForProcessing = internalMutation({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) => {
    const image = await ctx.db.get("images", imageId);
    if (
      image === null ||
      image.status !== "uploaded" ||
      image.rawStorageId === undefined
    ) {
      return null;
    }

    await ctx.db.patch("images", imageId, { status: "processing" });
    return { rawStorageId: image.rawStorageId, mime: image.mime };
  },
});

/**
 * Records a validation failure. Only a claimed (`processing`) row may fail, so
 * a stale or duplicate action can never overwrite a `ready` or already
 * `failed` row.
 */
export const markFailed = internalMutation({
  args: { imageId: v.id("images"), code: errorCode },
  handler: async (ctx, { imageId, code }) => {
    const image = await ctx.db.get("images", imageId);
    if (image === null || image.status !== "processing") {
      return false;
    }

    await ctx.db.patch("images", imageId, { status: "failed", failureCode: code });
    // TODO(task 3): delete the raw and processed storage objects and write an
    // audit row here. Deliberately not done yet: task 3 owns failure cleanup.
    return true;
  },
});