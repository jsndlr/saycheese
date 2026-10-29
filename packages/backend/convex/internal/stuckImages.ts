import { PROCESSING_TIMEOUT_MS, SCORING_TIMEOUT_MS } from "@saycheese/core/limits";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { env } from "../env";
import { primaryProvider, providerOrder } from "../lib/providers";
import { failImage } from "./images";
import { recordUnavailable } from "./scoring";

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

    // `scoring` rows whose action never finished. They are not image failures:
    // the variants are fine and only the score is missing, so they get the
    // stable `unavailable` score (and the UI keeps showing the image).
    // Timestamp-less rows are excluded exactly like `processing` above: the
    // seed's demo `scoring` row has no timestamp and must survive; every row
    // `markReady` creates has one.
    const scoringCutoff = now - SCORING_TIMEOUT_MS;
    const scoring = await ctx.db
      .query("images")
      .withIndex("by_status_scoring_started", (q) =>
        q
          .eq("status", "scoring")
          .gt("scoringStartedAt", 0)
          .lt("scoringStartedAt", scoringCutoff),
      )
      .take(limit);

    const primaryName = providerOrder(env)[0];
    let primaryModel = "unknown";
    try {
      // Adapters added in tasks 4/5 may not be implemented yet; the sweep must
      // still converge, so an unavailable model label is acceptable here.
      primaryModel = primaryProvider(env).model;
    } catch {
      primaryModel = "unknown";
    }

    let scoringRecorded = 0;
    for (const image of scoring) {
      if (
        await recordUnavailable(ctx, image._id, {
          provider: primaryName,
          providerModel: primaryModel,
          configVersion: env.SCORING_CONFIG_VERSION,
          at: now,
        })
      ) {
        scoringRecorded += 1;
      }
    }

    // Reschedule only when a full batch actually made progress: a full batch
    // of rows that are all too young makes no progress, and scheduling again
    // would loop forever without changing anything.
    const more =
      (processing.length === limit && processingFailed > 0) ||
      (uploaded.length === limit && uploadedFailed > 0) ||
      (scoring.length === limit && scoringRecorded > 0);
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
        scoringChecked: scoring.length,
        scoringRecorded,
        more,
      }),
    );

    return {
      processingChecked: processing.length,
      processingFailed,
      uploadedChecked: uploaded.length,
      uploadedFailed,
      scoringChecked: scoring.length,
      scoringRecorded,
      more,
    };
  },
});