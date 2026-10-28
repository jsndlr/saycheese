import { PROCESSING_TIMEOUT_MS } from "@saycheese/core/limits";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { failImage } from "./images";

/**
 * Fails rows whose processing never finished.
 *
 * A Node action is killed after 10 minutes
 * (https://docs.convex.dev/production/state/limits#execution-time-and-scheduling),
 * so a row claimed longer than `PROCESSING_TIMEOUT_MS` ago cannot still have a
 * live action behind it. An `uploaded` row of the same age means the scheduled
 * `process` action never ran. Both are failed with `IMAGE_TIMEOUT`, which also
 * deletes the storage objects the row still references.
 *
 * Each status is read from its own index in a bounded batch, and a full batch
 * schedules the next run instead of scanning the table. `failImage` is the
 * same plain function `internal/images:markFailed` uses; a mutation cannot
 * `runMutation`.
 */

/** Rows failed per status per mutation; leaves headroom in the transaction. */
export const STUCK_BATCH_SIZE = 100;

export const run = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize }) => {
    const limit = Math.max(1, Math.trunc(batchSize ?? STUCK_BATCH_SIZE));
    const now = Date.now();
    const cutoff = now - PROCESSING_TIMEOUT_MS;

    const processing = await ctx.db
      .query("images")
      .withIndex("by_status_started", (q) =>
        // Starting strictly above 0 excludes rows whose `processingStartedAt`
        // is missing: Convex sorts missing index values before every number.
        // Such a row is deliberately ignored, never auto-failed: every claim
        // since this change writes the timestamp, and on 2026-10-29 neither
        // deployment had a processing row without it (prod and dev had 0
        // processing rows at all). A stuck row stays visible and recoverable;
        // a wrongly failed row loses its upload.
        q
          .eq("status", "processing")
          .gt("processingStartedAt", 0)
          .lt("processingStartedAt", cutoff),
      )
      .take(limit);

    let processingFailed = 0;
    for (const image of processing) {
      if (await failImage(ctx, image._id, "IMAGE_TIMEOUT", now)) {
        processingFailed += 1;
      }
    }

    const uploaded = await ctx.db
      .query("images")
      .withIndex("by_status_created", (q) =>
        q.eq("status", "uploaded").lt("createdAt", cutoff),
      )
      .take(limit);

    let uploadedFailed = 0;
    for (const image of uploaded) {
      if (await failImage(ctx, image._id, "IMAGE_TIMEOUT", now)) {
        uploadedFailed += 1;
      }
    }

    // Reschedule only when a full batch actually failed rows: a full batch of
    // rows that are all too young makes no progress, and scheduling again
    // would loop forever without changing anything.
    const more =
      (processing.length === limit && processingFailed > 0) ||
      (uploaded.length === limit && uploadedFailed > 0);
    if (more) {
      await ctx.scheduler.runAfter(0, internal.internal.stuckImages.run, {});
    }

    console.log(
      JSON.stringify({
        event: "stuckImages.run",
        processingChecked: processing.length,
        processingFailed,
        uploadedChecked: uploaded.length,
        uploadedFailed,
        more,
      }),
    );

    return {
      processingChecked: processing.length,
      processingFailed,
      uploadedChecked: uploaded.length,
      uploadedFailed,
      more,
    };
  },
});