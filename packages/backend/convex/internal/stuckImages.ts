import { PROCESSING_TIMEOUT_MS, SCORING_TIMEOUT_MS } from "@saycheese/core/limits";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
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

/** Rows the scoring sweep may read per run while looking for expired jobs. */
const STUCK_SCAN_LIMIT = 500;

/**
 * How long a `scoring` row may wait for a workpool slot before the sweep
 * treats the job as lost. The action stamps `scoringJobStartedAt` when it
 * begins; from then on `SCORING_TIMEOUT_MS` applies. This grace only covers
 * the enqueue-to-start gap, which a backlog can stretch well past the timeout.
 */
const SCORING_NEVER_STARTED_GRACE_MS = SCORING_TIMEOUT_MS + 25 * 60_000;

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

    // A `processing` row written before the start timestamp existed is not on
    // the index above, so it would stay stuck forever. After a much longer
    // grace it is failed the same way. `scoring` deliberately has no such
    // fallback: the seed's demo row is a timestamp-less `scoring` row, and
    // every real row gets a timestamp from `markReady`.
    const legacyProcessing = (
      await ctx.db
        .query("images")
        .withIndex("by_status_created", (q) =>
          q
            .eq("status", "processing")
            .lt("createdAt", now - PROCESSING_TIMEOUT_MS * 4),
        )
        .take(limit)
    ).filter((image) => image.processingStartedAt === undefined);
    for (const image of legacyProcessing) {
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
    // Two different staleness rules share this index, oldest enqueue first:
    // - a job the action started is dead once its own start is older than the
    //   timeout;
    // - a job that never started is not dead, only slow: a busy workpool can
    //   hold it for minutes, so it gets a longer grace from the enqueue time.
    // The rules cannot be expressed in the index range, so walk it in order and
    // keep the eligible rows. Filtering after `take(limit)` would let a batch of
    // slow-but-alive jobs hide expired ones behind it, so the scan is bounded
    // by `STUCK_SCAN_LIMIT` rather than by the batch size.
    const scoring: Doc<"images">[] = [];
    const scoringQuery = ctx.db
      .query("images")
      .withIndex("by_status_scoring_started", (q) =>
        q
          .eq("status", "scoring")
          .gt("scoringStartedAt", 0)
          .lt("scoringStartedAt", now - SCORING_TIMEOUT_MS),
      );
    let scanned = 0;
    for await (const image of scoringQuery) {
      scanned += 1;
      const expired =
        image.scoringJobStartedAt !== undefined
          ? image.scoringJobStartedAt < now - SCORING_TIMEOUT_MS
          : (image.scoringStartedAt ?? now) <
            now - SCORING_NEVER_STARTED_GRACE_MS;
      if (expired) {
        scoring.push(image);
      }
      if (scoring.length === limit || scanned === STUCK_SCAN_LIMIT) {
        break;
      }
    }

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
      ((processing.length === limit || legacyProcessing.length === limit) &&
        processingFailed > 0) ||
      (uploaded.length === limit && uploadedFailed > 0) ||
      (scoring.length === limit && scoringRecorded > 0);
    if (more) {
      await ctx.scheduler.runAfter(0, internal.internal.stuckImages.run, {});
    }

    console.log(
      JSON.stringify({
        event: "stuckImages.run",
        processingChecked: processing.length + legacyProcessing.length,
        processingFailed,
        uploadedChecked: uploaded.length,
        uploadedFailed,
        scoringChecked: scoring.length,
        scoringRecorded,
        more,
      }),
    );

    return {
      processingChecked: processing.length + legacyProcessing.length,
      processingFailed,
      uploadedChecked: uploaded.length,
      uploadedFailed,
      scoringChecked: scoring.length,
      scoringRecorded,
      more,
    };
  },
});