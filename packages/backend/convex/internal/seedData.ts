import type { ErrorCode } from "@saycheese/core/errors";
import type { ScoreStatus } from "@saycheese/core/scoring";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { env } from "../env";
import { isStorageIdReferenced } from "../lib/storage";
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

function storageIdsOf(image: SeedImageRow): Id<"_storage">[] {
  return [
    image.rawStorageId,
    image.storageId,
    image.previewId,
    image.thumbId,
  ].filter((id): id is Id<"_storage"> => id !== undefined);
}

/** Hashes already seeded for a user; the action skips storing their blobs. */
export const hashes = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<string[]> => {
    const rows = await ctx.db
      .query("images")
      .withIndex("by_user_hash", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => row.sha256);
  },
});

/**
 * Writes every image that does not exist yet for (userId, sha256) and returns
 * storage ids that were passed in but are not referenced by any row, so the
 * action can delete objects it stored for a row that raced into existence.
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
        imagesSkipped += 1;
        for (const storageId of storageIdsOf(image)) {
          if (!(await isStorageIdReferenced(ctx, storageId))) {
            unusedStorageIds.push(storageId);
          }
        }
        continue;
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
