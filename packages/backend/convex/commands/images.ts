import {
  UPLOAD_COMMIT_GRACE_MS,
  UPLOAD_URL_TTL_MS,
  exceedsByteCap,
  isAllowedImageMime,
  isHeicMime,
} from "@saycheese/core/limits";
import { zid } from "convex-helpers/server/zod4";
import { z } from "zod";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { authedMutation, fail } from "../functions";
import { isProviderOutage } from "../internal/scoring";
import { consume } from "../lib/rateLimits";
import { scoringPool } from "../lib/scoringPool";
import { isStorageIdReferenced, rawUploadOwner } from "../lib/storage";
import type { ImageDto } from "../model/images";
import { ownedImage, toImageDto } from "../model/images";

const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToHex(value: string): string {
  let accumulator = 0;
  let bits = 0;
  let hex = "";
  for (const char of value) {
    if (char === "=") {
      break;
    }
    const digit = base64Alphabet.indexOf(char);
    if (digit === -1) {
      throw new Error("Storage metadata contains an invalid sha256 encoding");
    }
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      hex += ((accumulator >> bits) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return hex;
}

/**
 * The Convex backend documents `_storage.sha256` as hex, while convex-test
 * (and the deploy API in some versions) stores standard base64. Normalise both
 * to the lowercase hex form used by `images.sha256`.
 */
function storageSha256Hex(stored: string): string {
  if (/^[0-9a-f]{64}$/i.test(stored)) {
    return stored.toLowerCase();
  }
  return base64ToHex(stored);
}

export const createUpload = authedMutation({
  args: {},
  permission: { resource: "image", action: "create" },
  handler: async (ctx) => {
    // Minting a URL is cheap and creates nothing, so it has its own, looser
    // limit. The real cap is `commitUpload`, because one URL can be reused
    // until it expires.
    await consume(ctx, "uploadUrl", ctx.user.id);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl, expiresAt: Date.now() + UPLOAD_URL_TTL_MS };
  },
});

const commitArgs = z.object({
  storageId: zid("_storage"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 lowercase hex characters."),
  bytes: z.number().int().positive(),
  mime: z.string(),
});

export const commitUpload = authedMutation({
  args: commitArgs,
  permission: { resource: "image", action: "create" },
  handler: async (ctx, args) => {
    const metadata = await ctx.db.system.get(args.storageId);
    if (metadata === null) {
      return fail("NOT_FOUND");
    }

    // Query invariant for task 3: public queries must never return raw storage
    // ids to clients, only URLs obtained from `ctx.storage.getUrl`.
    const now = Date.now();
    if (
      metadata._creationTime <
      now - UPLOAD_URL_TTL_MS - UPLOAD_COMMIT_GRACE_MS
    ) {
      return fail("UPLOAD_EXPIRED");
    }

    // Rejections throw, and Convex rolls storage deletes back with the failing
    // transaction (the backend's file-storage delete takes the same `tx` and is
    // aborted on error). Deleting the object here would therefore be a no-op.
    // The object stays unreferenced; Phase 3 needs an orphan sweep for uploads
    // that never commit.

    if (isHeicMime(args.mime)) {
      return fail("HEIC_UNSUPPORTED");
    }

    if (!isAllowedImageMime(args.mime)) {
      return fail("UNSUPPORTED_MEDIA_TYPE");
    }

    const serverSha256 = storageSha256Hex(metadata.sha256);
    if (args.bytes !== metadata.size || args.sha256 !== serverSha256) {
      return fail("VALIDATION_FAILED");
    }

    if (exceedsByteCap(metadata.size)) {
      return fail("PAYLOAD_TOO_LARGE");
    }

    // A retried commit must be idempotent. If the caller's own row already owns
    // this exact raw upload, the earlier attempt succeeded and only its
    // response was lost (the uploader retries the same storage id after a
    // network error). Anything else referencing the object is still rejected.
    const owner = await rawUploadOwner(ctx, args.storageId);
    if (owner !== null) {
      if (owner.userId === ctx.user.id && owner.sha256 === serverSha256) {
        return { id: owner._id, deduplicated: false };
      }
      return fail("VALIDATION_FAILED");
    }

    // A storage id is not bound to a user and every id is guessable only if it
    // leaks, but a commit must never claim any live object: raw uploads and all
    // processed variants are off limits. This runs before dedupe so the dedupe
    // delete below can never remove a referenced object.
    if (await isStorageIdReferenced(ctx, args.storageId)) {
      return fail("VALIDATION_FAILED");
    }

    const previous = (
      await ctx.db
        .query("images")
        .withIndex("by_user_hash", (q) =>
          q.eq("userId", ctx.user.id).eq("sha256", serverSha256),
        )
        .collect()
    ).find((image) => image.archivedAt === undefined && image.status !== "failed");

    if (previous !== undefined) {
      await ctx.storage.delete(args.storageId);
      return { id: previous._id, deduplicated: true };
    }

    // One token per committed upload. Consumed only after the cheap checks and
    // the dedupe lookup: a dedupe hit creates nothing and must not spend the
    // allowance. A rate-limited commit throws, so the storage delete above and
    // this insert roll back; the uploaded object is left for the orphan sweep.
    await consume(ctx, "upload", ctx.user.id);

    const imageId = await ctx.db.insert("images", {
      userId: ctx.user.id,
      sha256: serverSha256,
      rawStorageId: args.storageId,
      mime: args.mime,
      bytes: metadata.size,
      status: "uploaded",
      createdAt: now,
    });

    await ctx.db.insert("auditEvents", {
      actorId: ctx.user.id,
      action: "image.commit",
      table: "images",
      docId: imageId,
      after: { sha256: serverSha256, bytes: metadata.size, mime: args.mime },
      at: now,
    });

    await ctx.scheduler.runAfter(0, internal.actions.images.process, { imageId });

    return { id: imageId, deduplicated: false };
  },
});
/**
 * Plan 6.3 rescore. Allowed for a `scored` image whose current score is
 * `unavailable` (provider outage or daily quota) and for any `scored` image
 * with `force`. A real score without `force` is a no-op: the command is
 * idempotent and returns the current state without consuming a token.
 *
 * Failed/archived/uploading (and any other non-`scored`) image → validation
 * error: there is nothing to rescore, and silently re-running processing would
 * be a different operation.
 *
 * An unavailable score from a provider outage inside
 * `SCORING_OUTAGE_WINDOW_MS` is refused with SCORING_UNAVAILABLE instead of
 * re-hammering providers. That check runs **before** the limiter: the
 * rejection performs no provider work, so it costs nothing and must not spend
 * the user's allowance. The rescore limit protects provider calls, and only a
 * request that will actually enqueue one consumes a token.
 *
 * A quota-settled row is not an outage and may be retried; it will simply hit
 * the quota again until the daily window rolls over.
 */
export const rescore = authedMutation({
  args: { id: zid("images"), force: z.boolean().default(false) },
  permission: { resource: "image", action: "rescore" },
  handler: async (ctx, args): Promise<ImageDto> => {
    const image = await ownedImage(ctx, args.id, { includeArchived: true });
    if (image.archivedAt !== undefined || image.status !== "scored") {
      return fail("VALIDATION_FAILED");
    }

    const score =
      image.scoreId === undefined ? null : await ctx.db.get("scores", image.scoreId);
    const hasRealScore =
      score !== null && score.status !== "unavailable";
    if (hasRealScore && !args.force) {
      // Idempotent no-op, before the limiter: repeating the same call must not
      // burn the caller's rescore budget.
      return await toImageDto(ctx, image);
    }

    if (!args.force && (await isProviderOutage(ctx, image, Date.now()))) {
      // Before `consume`: an outage rejection does no provider work, so it must
      // not spend a token (and a throw would roll any consumption back anyway).
      return fail("SCORING_UNAVAILABLE");
    }

    await consume(ctx, "rescore", ctx.user.id);

    const now = Date.now();
    const run = (image.scoringRun ?? 0) + 1;
    await ctx.db.patch("images", args.id, {
      status: "scoring",
      scoreId: undefined,
      scoreCached: undefined,
      quotaExceeded: undefined,
      failureCode: undefined,
      scoringStartedAt: now,
      scoringJobStartedAt: undefined,
      scoringRun: run,
    });
    await ctx.db.insert("auditEvents", {
      actorId: ctx.user.id,
      action: "image.rescore",
      table: "images",
      docId: args.id,
      before: {
        status: image.status,
        scoreId: image.scoreId ?? null,
        scoreStatus: score?.status ?? null,
        force: args.force,
      },
      after: { status: "scoring" },
      at: now,
    });
    await scoringPool.enqueueAction(
      ctx,
      internal.actions.scoring.score,
      { imageId: args.id, run, force: args.force },
      { retry: false },
    );

    const updated = await ctx.db.get("images", args.id);
    return await toImageDto(ctx, updated ?? image);
  },
});

/**
 * Plan 4.4 archive. Archiving hides the row instead of deleting it: `archivedAt`
 * removes it from every list and detail query, while the audit trail and the
 * linked score row stay resolvable. The storage objects are not touched here;
 * `internal/archiveSweep` deletes them once `ARCHIVE_RETENTION_MS` has passed,
 * so an accidental archive is recoverable inside that window.
 *
 * Refused while the pipeline still holds the row. `uploaded`, `processing` and
 * `scoring` all have a scheduled action that will write the row; hiding it
 * underneath that action would race the write (and an archived image must
 * never be rescored). `ready` is a legacy state no production transition
 * produces, so it is not in the list.
 *
 * Idempotent in effect, not in response: a second call finds an archived row,
 * `ownedImage` hides it, and the caller gets the same NOT_FOUND as for any id
 * it can no longer reach. No rate limit: the operation is one owner-scoped
 * field write and costs no provider work.
 */
export const archive = authedMutation({
  args: { id: zid("images") },
  permission: { resource: "image", action: "archive" },
  handler: async (ctx, args): Promise<{ id: Id<"images"> }> => {
    const image = await ownedImage(ctx, args.id);
    if (
      image.status === "uploaded" ||
      image.status === "processing" ||
      image.status === "scoring"
    ) {
      return fail("VALIDATION_FAILED");
    }

    const now = Date.now();
    await ctx.db.patch("images", args.id, { archivedAt: now });
    await ctx.db.insert("auditEvents", {
      actorId: ctx.user.id,
      action: "image.archive",
      table: "images",
      docId: args.id,
      before: { status: image.status, archivedAt: null },
      after: { status: image.status, archivedAt: now },
      at: now,
    });

    return { id: image._id };
  },
});
