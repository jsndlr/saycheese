import { UPLOAD_COMMIT_GRACE_MS, UPLOAD_URL_TTL_MS } from "@saycheese/core/limits";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { isStorageIdReferenced } from "../lib/storage";

/**
 * Deletes `_storage` objects nothing references.
 *
 * Objects younger than the commit cutoff are never touched, so an upload that
 * is still in flight is safe, and an object past the cutoff can no longer be
 * committed (`commitUpload` rejects it as `UPLOAD_EXPIRED`).
 *
 * The sweep walks `_storage.by_creation_time` forward from a stored watermark
 * instead of rescanning the table, in bounded batches per mutation, scheduling
 * the next batch when one fills. Skipping already-checked objects is safe: an
 * object that was referenced when checked only loses its reference through
 * code paths that also delete it (a deduplicated commit deletes the raw upload,
 * archive cleanup deletes the variants). Any future code that drops a
 * reference without deleting the object would leak it; see `lib/storage.ts`.
 */

/** `_storage` objects checked per mutation; leaves headroom in the transaction. */
export const SWEEP_BATCH_SIZE = 200;

const SWEEP_KEY = "storageSweep";

export const run = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize }) => {
    const limit = Math.max(1, Math.trunc(batchSize ?? SWEEP_BATCH_SIZE));
    const cutoff = Date.now() - UPLOAD_URL_TTL_MS - UPLOAD_COMMIT_GRACE_MS;

    const state = await ctx.db
      .query("maintenance")
      .withIndex("by_key", (q) => q.eq("key", SWEEP_KEY))
      .first();
    const previousWatermark = state?.watermark ?? 0;

    const objects = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) =>
        q.gt("_creationTime", previousWatermark).lte("_creationTime", cutoff),
      )
      .take(limit);

    let deleted = 0;
    for (const object of objects) {
      if (await isStorageIdReferenced(ctx, object._id)) {
        continue;
      }
      await ctx.storage.delete(object._id);
      deleted += 1;
    }

    const lastChecked = objects.at(-1);
    const watermark = lastChecked?._creationTime ?? previousWatermark;
    if (lastChecked !== undefined && watermark !== previousWatermark) {
      if (state === null) {
        await ctx.db.insert("maintenance", { key: SWEEP_KEY, watermark });
      } else {
        await ctx.db.patch("maintenance", state._id, { watermark });
      }
    }

    const more = objects.length === limit;
    if (more) {
      await ctx.scheduler.runAfter(0, internal.internal.storageSweep.run, {});
    }

    // Counts only: ids of user content never reach the logs.
    console.log(
      JSON.stringify({
        event: "storageSweep.run",
        checked: objects.length,
        deleted,
        watermark,
        more,
      }),
    );

    return { checked: objects.length, deleted, watermark, more };
  },
});