import type { ProviderName } from "../lib/providers/types";
import { UNAVAILABLE_REASON, type ScoreStatus } from "@saycheese/core/scoring";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { provider, scoreStatus, scoringOutcome } from "../validators";

/**
 * Database half of the scoring action. Edge-safe (no provider SDKs, no Node
 * built-ins) so the tests can call it directly.
 */

export const scoringAttempt = v.object({
  provider,
  outcome: scoringOutcome,
  errorCode: v.optional(v.string()),
  latencyMs: v.number(),
  at: v.number(),
});

export type ScoringAttempt = {
  provider: ProviderName;
  outcome: "success" | "retryable_error" | "fatal_error" | "timeout";
  errorCode?: string;
  latencyMs: number;
  at: number;
};

export const scoreResult = v.object({
  score: v.union(v.number(), v.null()),
  confidence: v.union(v.number(), v.null()),
  faceCount: v.number(),
  status: scoreStatus,
  reason: v.string(),
  provider,
  providerModel: v.string(),
  configVersion: v.string(),
  latencyMs: v.number(),
  costMicros: v.optional(v.number()),
});

export type ScoreResult = {
  score: number | null;
  confidence: number | null;
  faceCount: number;
  status: ScoreStatus;
  reason: string;
  provider: ProviderName;
  providerModel: string;
  configVersion: string;
  latencyMs: number;
  costMicros?: number;
};

/**
 * What an enqueued score action needs. `mime` is always `image/webp`: scoring
 * reads the re-encoded `original` variant, never the raw upload. `null` means
 * the row is no longer `scoring` (or has no variant to read), so the action is
 * a no-op — a duplicate workpool run cannot score twice.
 */
export const load = internalQuery({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) => {
    const image = await ctx.db.get("images", imageId);
    if (image === null || image.status !== "scoring" || image.storageId === undefined) {
      return null;
    }
    return {
      storageId: image.storageId,
      sha256: image.sha256,
      mime: "image/webp" as const,
    };
  },
});

/**
 * Stores the terminal outcome of one scoring run.
 *
 * The status check makes the write idempotent: if the row left `scoring`
 * (sweep, archive, deletion) nothing is written — no score, no attempt rows,
 * no audit — and the caller gets `false`.
 *
 * `score.record` marks a provider answer (including a provider-reported error
 * result); `score.fail` marks an outcome where every attempt failed. Both keep
 * the image `scored`, because `unavailable` is a score status, not an image
 * failure: the image itself is fine and the UI renders a stable state.
 */
export const record = internalMutation({
  args: {
    imageId: v.id("images"),
    result: scoreResult,
    attempts: v.array(scoringAttempt),
  },
  handler: async (ctx, { imageId, result, attempts }) => {
    const image = await ctx.db.get("images", imageId);
    if (image === null || image.status !== "scoring") {
      return false;
    }

    const now = Date.now();
    const scoreId = await ctx.db.insert("scores", {
      sha256: image.sha256,
      score: result.score,
      confidence: result.confidence,
      faceCount: result.faceCount,
      status: result.status,
      reason: result.reason,
      provider: result.provider,
      providerModel: result.providerModel,
      configVersion: result.configVersion,
      latencyMs: result.latencyMs,
      costMicros: result.costMicros,
      createdAt: now,
    });

    for (const attempt of attempts) {
      await ctx.db.insert("scoringAttempts", {
        imageId,
        provider: attempt.provider,
        outcome: attempt.outcome,
        errorCode: attempt.errorCode,
        latencyMs: attempt.latencyMs,
        at: attempt.at,
      });
    }

    await ctx.db.patch("images", imageId, {
      status: "scored",
      scoreId,
      scoringStartedAt: undefined,
    });

    await ctx.db.insert("auditEvents", {
      actorId: "system:scoring",
      action: result.status === "unavailable" ? "score.fail" : "score.record",
      table: "images",
      docId: imageId,
      before: { status: "scoring" },
      after: { status: "scored", scoreId, scoreStatus: result.status },
      at: now,
    });

    return true;
  },
});

/**
 * The stable fallback used when no provider answered (all attempts failed, or
 * the stuck sweep gave up). Mirrors the core mapping of a provider error, so
 * the row the UI reads is shaped exactly like a real provider answer.
 */
export function unavailableResult(options: {
  provider: ProviderName;
  providerModel: string;
  configVersion: string;
  latencyMs: number;
}): ScoreResult {
  return {
    score: null,
    confidence: null,
    faceCount: 0,
    status: "unavailable",
    reason: UNAVAILABLE_REASON,
    provider: options.provider,
    providerModel: options.providerModel,
    configVersion: options.configVersion,
    latencyMs: options.latencyMs,
    costMicros: 0,
  };
}

/**
 * Sweep half: records the fallback and clears `scoringStartedAt` in the
 * caller's transaction. Returns false when the row moved on.
 */
export async function recordUnavailable(
  ctx: Pick<MutationCtx, "db">,
  imageId: Id<"images">,
  options: {
    provider: ProviderName;
    providerModel: string;
    configVersion: string;
    at: number;
  },
): Promise<boolean> {
  const image = await ctx.db.get("images", imageId);
  if (image === null || image.status !== "scoring") {
    return false;
  }

  const result = unavailableResult({
    provider: options.provider,
    providerModel: options.providerModel,
    configVersion: options.configVersion,
    latencyMs: 0,
  });
  const scoreId = await ctx.db.insert("scores", {
    sha256: image.sha256,
    score: result.score,
    confidence: result.confidence,
    faceCount: result.faceCount,
    status: result.status,
    reason: result.reason,
    provider: result.provider,
    providerModel: result.providerModel,
    configVersion: result.configVersion,
    latencyMs: result.latencyMs,
    costMicros: result.costMicros,
    createdAt: options.at,
  });
  await ctx.db.patch("images", imageId, {
    status: "scored",
    scoreId,
    scoringStartedAt: undefined,
  });
  await ctx.db.insert("auditEvents", {
    actorId: "system:scoring",
    action: "score.fail",
    table: "images",
    docId: imageId,
    before: { status: "scoring" },
    after: { status: "scored", scoreId, scoreStatus: "unavailable" },
    at: options.at,
  });
  return true;
}