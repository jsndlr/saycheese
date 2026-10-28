import type { ErrorCode } from "@saycheese/core/errors";
import type { ScoreStatus } from "@saycheese/core/scoring";
import { v } from "convex/values";

import type { Id, Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { env } from "../env";
import { deleteIfExists, isStorageIdReferenced } from "../lib/storage";
import {
  hasStorageRefs,
  isRepairableSeedState,
  matchesSeedState,
} from "../model/seed";
import { errorCode, imageStatus, scoreStatus } from "../validators";

/**
 * Mutation half of the seed. Node-only work (sharp, password hashing) lives in
 * `internal/seed.ts`; this module is safe to load in the edge runtime so the
 * tests can exercise it with pre-stored fixture blobs.
 */

const seedScore = v.object({
  score: v.union(v.number(), v.null()),
  confidence: v.union(v.number(), v.null()),
  faceCount: v.number(),
  status: scoreStatus,
  reason: v.string(),
  latencyMs: v.number(),
});

const seedImage = v.object({
  sha256: v.string(),
  mime: v.string(),
  bytes: v.number(),
  width: v.number(),
  height: v.number(),
  status: imageStatus,
  failureCode: v.optional(errorCode),
  rawStorageId: v.optional(v.id("_storage")),
  storageId: v.optional(v.id("_storage")),
  previewId: v.optional(v.id("_storage")),
  thumbId: v.optional(v.id("_storage")),
  createdAt: v.number(),
  score: v.optional(seedScore),
});

export type SeedImageRow = {
  sha256: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  status: "uploaded" | "processing" | "ready" | "scoring" | "scored" | "failed";
  failureCode?: ErrorCode;
  rawStorageId?: Id<"_storage">;
  storageId?: Id<"_storage">;
  previewId?: Id<"_storage">;
  thumbId?: Id<"_storage">;
  createdAt: number;
  score?: {
    score: number | null;
    confidence: number | null;
    faceCount: number;
    status: ScoreStatus;
    reason: string;
    latencyMs: number;
  };
};

export type ExistingSeedImage = {
  sha256: string;
  status: SeedImageRow["status"];
  failureCode: ErrorCode | null;
  hasStorage: boolean;
};

function storageIdsOf(image: SeedImageRow): Id<"_storage">[] {
  return [
    image.rawStorageId,
    image.storageId,
    image.previewId,
    image.thumbId,
  ].filter((id): id is Id<"_storage"> => id !== undefined);
}

/**
 * Removes a stale seed row and everything it owns: its score, its audit rows
 * and every storage object it still references. Called only for rows the seed
 * is allowed to replace (`isRepairableSeedState`); the delete and the insert
 * that follows commit in the same transaction.
 */
async function deleteSeedImage(
  ctx: MutationCtx,
  image: Doc<"images">,
): Promise<void> {
  const storageIds = [
    image.rawStorageId,
    image.storageId,
    image.previewId,
    image.thumbId,
  ].filter((id): id is Id<"_storage"> => id !== undefined);

  const audits = await ctx.db
    .query("auditEvents")
    .withIndex("by_doc", (q) => q.eq("docId", image._id))
    .collect();
  for (const audit of audits) {
    await ctx.db.delete("auditEvents", audit._id);
  }
  if (image.scoreId !== undefined) {
    await ctx.db.delete("scores", image.scoreId);
  }
  await ctx.db.delete("images", image._id);

  for (const storageId of storageIds) {
    await deleteIfExists(ctx, storageId);
  }
}

/** Seed rows already present for a user, with the state the action compares. */
export const existing = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<ExistingSeedImage[]> => {
    const rows = await ctx.db
      .query("images")
      .withIndex("by_user_hash", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => ({
      sha256: row.sha256,
      status: row.status,
      failureCode: row.failureCode ?? null,
      hasStorage: hasStorageRefs(row),
    }));
  },
});

/**
 * Writes every image whose spec is not already satisfied for (userId, sha256).
 * A stale row the seed owns (`uploaded`, or `failed` with IMAGE_TIMEOUT) is
 * deleted with its storage objects and audit rows, then recreated from the
 * plan, so a demo deployment converges on the current spec instead of
 * duplicating rows. Objects that were passed in but not referenced by any row
 * are returned so the action can delete them.
 */
export const commit = internalMutation({
  args: { userId: v.string(), images: v.array(seedImage) },
  handler: async (ctx, { userId, images }) => {
    let imagesCreated = 0;
    let imagesSkipped = 0;
    const unusedStorageIds: Id<"_storage">[] = [];

    for (const image of images) {
      const existing = await ctx.db
        .query("images")
        .withIndex("by_user_hash", (q) =>
          q.eq("userId", userId).eq("sha256", image.sha256),
        )
        .first();

      if (existing !== null) {
        const existingState = {
          status: existing.status,
          failureCode: existing.failureCode ?? null,
          hasStorage: hasStorageRefs(existing),
        };
        const repairable =
          !matchesSeedState(image, existingState) &&
          isRepairableSeedState(existingState);
        if (!repairable) {
          imagesSkipped += 1;
          for (const storageId of storageIdsOf(image)) {
            if (!(await isStorageIdReferenced(ctx, storageId))) {
              unusedStorageIds.push(storageId);
            }
          }
          continue;
        }
        // The new plan already stored its objects; retire the stale row's.
        await deleteSeedImage(ctx, existing);
      }

      const imageId = await ctx.db.insert("images", {
        userId,
        sha256: image.sha256,
        rawStorageId: image.rawStorageId,
        storageId: image.storageId,
        previewId: image.previewId,
        thumbId: image.thumbId,
        mime: image.mime,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        status: image.status,
        failureCode: image.failureCode,
        createdAt: image.createdAt,
      });

      if (image.score !== undefined) {
        const scoreId = await ctx.db.insert("scores", {
          sha256: image.sha256,
          score: image.score.score,
          confidence: image.score.confidence,
          faceCount: image.score.faceCount,
          status: image.score.status,
          reason: image.score.reason,
          provider: "stub",
          providerModel: "stub-v1",
          configVersion: env.SCORING_CONFIG_VERSION,
          latencyMs: image.score.latencyMs,
          createdAt: image.createdAt + image.score.latencyMs,
        });
        await ctx.db.patch("images", imageId, { scoreId });
      }

      for (const storageId of storageIdsOf(image)) {
        if (!(await isStorageIdReferenced(ctx, storageId))) {
          throw new Error(
            `Seed image ${image.sha256} references ${storageId}, but the reference check failed.`,
          );
        }
      }

      imagesCreated += 1;
    }

    return { imagesCreated, imagesSkipped, unusedStorageIds };
  },
});
