import { ARCHIVE_RETENTION_MS } from "@saycheese/core/limits";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { deleteIfExists } from "../lib/storage";

/**
 * Deletes the storage objects of images archived longer than
 * `ARCHIVE_RETENTION_MS` ago. The row stays: its audit trail and score link
 * must remain resolvable, and the DTO never exposes archived rows anyway.
 *
 * Archived rows are the one reference-dropping path whose mutation does not
 * delete the objects itself, so this sweep MUST do it. The orphan sweep visits
 * every `_storage` object once and will not revisit them (see
 * `lib/storage.ts`).
 *
 * The query reads `by_unpurged_archived` with an equality on the missing
 * `purgedAt`, so every visited row is one that still needs work: a purged row
 * leaves the index range instead of being re-read forever. That equality must
 * lead the index — Convex refuses an equality after a range on the same index.
 * The range starts strictly above 0 because live rows have no `archivedAt` and
 * sort before every number.
 *
 * A row with no storage fields at all (a failed upload, or one already
 * handled) only gets its `purgedAt` marker, so the row still leaves the range.
 */

/** Rows visited per mutation; leaves headroom in the transaction. */
export const ARCHIVE_SWEEP_BATCH_SIZE = 100;

export const run = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize }) => {
    const limit = Math.max(1, Math.trunc(batchSize ?? ARCHIVE_SWEEP_BATCH_SIZE));
    const now = Date.now();
    const cutoff = now - ARCHIVE_RETENTION_MS;

    const images = await ctx.db
      .query("images")
      .withIndex("by_unpurged_archived", (q) =>
        q.eq("purgedAt", undefined).gt("archivedAt", 0).lt("archivedAt", cutoff),
      )
      .take(limit);

    let purged = 0;
    for (const image of images) {
      const storageIds = [
        image.storageId,
        image.previewId,
        image.thumbId,
        image.rawStorageId,
      ].filter((id) => id !== undefined);

      for (const storageId of storageIds) {
        await deleteIfExists(ctx, storageId);
      }
      await ctx.db.patch("images", image._id, {
        storageId: undefined,
        previewId: undefined,
        thumbId: undefined,
        rawStorageId: undefined,
        purgedAt: now,
      });
      if (storageIds.length > 0) {
        purged += 1;
      }
    }

    // Every visited row leaves the index range (it is purged or marked), so a
    // full batch always made progress; a partial one is the end of the range.
    const more = images.length === limit;
    if (more) {
      await ctx.scheduler.runAfter(0, internal.internal.archiveSweep.run, {});
    }

    // Counts only: ids of user content never reach the logs.
    console.log(
      JSON.stringify({
        event: "archiveSweep.run",
        checked: images.length,
        purged,
        more,
      }),
    );

    return { checked: images.length, purged, more };
  },
});
