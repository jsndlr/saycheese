import type { ErrorCode } from "@saycheese/core/errors";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { deleteIfExists } from "../lib/storage";
import { scoringPool } from "../lib/scoringPool";
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

    await ctx.db.patch("images", imageId, {
      status: "processing",
      processingStartedAt: Date.now(),
    });
    return { rawStorageId: image.rawStorageId, mime: image.mime };
  },
});

/**
 * Publishes the re-encoded variants and retires the raw upload in one
 * transaction. The status check makes a stale action harmless: a row that was
 * failed, archived or already finished in the meantime is left untouched and
 * the caller deletes the objects it just stored.
 */
export const markReady = internalMutation({
  args: {
    imageId: v.id("images"),
    storageId: v.id("_storage"),
    previewId: v.id("_storage"),
    thumbId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args) => {
    const image = await ctx.db.get("images", args.imageId);
    if (image === null || image.status !== "processing") {
      return false;
    }

    const rawStorageId = image.rawStorageId;
    await ctx.db.patch("images", args.imageId, {
      // Straight to `scoring`: the variants exist, so the row now belongs to
      // the scoring pool. `ready` remains a valid (legacy/test) state but no
      // production transition produces it any more.
      status: "scoring",
      scoringStartedAt: Date.now(),
      storageId: args.storageId,
      previewId: args.previewId,
      thumbId: args.thumbId,
      width: args.width,
      height: args.height,
      // Unset as well as delete: the row must stop pointing at the raw object.
      rawStorageId: undefined,
      // No longer processing, so the stuck sweep has nothing to compare.
      processingStartedAt: undefined,
    });
    if (rawStorageId !== undefined) {
      await deleteIfExists(ctx, rawStorageId);
    }

    // Same transaction as the patch: the row can never be `scoring` without a
    // queued job (or a timestamp the stuck sweep can act on). Retries are
    // owned by the action, so the component's retry is explicitly off.
    await scoringPool.enqueueAction(
      ctx,
      internal.scoring.score,
      { imageId: args.imageId },
      { retry: false },
    );
    return true;
  },
});

/**
 * Shared failure transition: `uploaded`/`processing -> failed`.
 *
 * Everything happens in the caller's transaction, so the row update, the
 * storage deletes and the audit row commit or roll back together. A row that
 * already finished (`ready`, `scored`, `failed`, ...) is left alone and the
 * call returns `false`, so a stale action or sweep can never rewrite it.
 *
 * `uploaded` is allowed because the stuck sweep fails uploads whose scheduled
 * process action never ran; the process action itself always claims first.
 */
export async function failImage(
  ctx: Pick<MutationCtx, "db" | "storage">,
  imageId: Id<"images">,
  code: ErrorCode,
  now: number,
): Promise<boolean> {
  const image = await ctx.db.get("images", imageId);
  if (
    image === null ||
    (image.status !== "uploaded" && image.status !== "processing")
  ) {
    return false;
  }

  const storageIds = [
    ...new Set(
      [image.rawStorageId, image.storageId, image.previewId, image.thumbId].filter(
        (storageId): storageId is Id<"_storage"> => storageId !== undefined,
      ),
    ),
  ];

  await ctx.db.patch("images", imageId, {
    status: "failed",
    failureCode: code,
    rawStorageId: undefined,
    storageId: undefined,
    previewId: undefined,
    thumbId: undefined,
  });

  // Deletes run inside this mutation, so they commit with the row update.
  // Missing objects are skipped: a delete of a missing id would throw and roll
  // the failure transition back (and abort a whole sweep batch with it).
  for (const storageId of storageIds) {
    await deleteIfExists(ctx, storageId);
  }

  await ctx.db.insert("auditEvents", {
    actorId: "system:process",
    action: "image.fail",
    table: "images",
    docId: imageId,
    before: { status: image.status },
    after: { status: "failed", failureCode: code },
    at: now,
  });

  return true;
}

/**
 * Records a validation or timeout failure. Only `uploaded`/`processing` rows
 * may fail, so a stale or duplicate call can never overwrite a `ready`,
 * `scored` or already `failed` row.
 */
export const markFailed = internalMutation({
  args: { imageId: v.id("images"), code: errorCode },
  handler: async (ctx, { imageId, code }) => {
    return await failImage(ctx, imageId, code, Date.now());
  },
});