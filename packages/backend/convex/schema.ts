import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  auditAction,
  errorCode,
  imageStatus,
  jsonRecord,
  provider,
  scoreStatus,
  scoringOutcome,
} from "./validators";

// `schemaValidation` stays at its default (`true`): every write is validated.
export default defineSchema({
  images: defineTable({
    // Better Auth user id.
    userId: v.string(),
    // Lowercase hex, verified against `_storage.sha256` at commit time.
    sha256: v.string(),
    // Present from upload until processing finishes, then removed.
    rawStorageId: v.optional(v.id("_storage")),
    // Set together when the processed variants are ready.
    storageId: v.optional(v.id("_storage")),
    previewId: v.optional(v.id("_storage")),
    thumbId: v.optional(v.id("_storage")),
    mime: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    status: imageStatus,
    // Set when the process action claims the row; the stuck sweep compares it
    // against `PROCESSING_TIMEOUT_MS`.
    processingStartedAt: v.optional(v.number()),
    // Set when `markReady` hands the row to the scoring pool; the stuck sweep
    // compares it against `SCORING_TIMEOUT_MS`. Missing values are ignored.
    scoringStartedAt: v.optional(v.number()),
    // Monotonic run id. Every transition into `scoring` increments it and the
    // enqueued job carries it, so a job from an older run can never settle a
    // newer one (for example after a rescore).
    scoringRun: v.optional(v.number()),
    failureCode: v.optional(errorCode),
    scoreId: v.optional(v.id("scores")),
    // True when `scoreId` was linked from the content cache instead of a
    // provider run. Per image, never per score: the score row is shared.
    scoreCached: v.optional(v.boolean()),
    // True when the image settled with an `unavailable` score because the
    // caller's daily provider budget was exhausted, not because a provider
    // failed. The score row's reason is the SCORING_QUOTA copy; variants stay.
    quotaExceeded: v.optional(v.boolean()),
    createdAt: v.number(),
    // Set by `commands.images.archive`; hides the row from every query.
    archivedAt: v.optional(v.number()),
    // Set by `internal/archiveSweep` once the storage objects are deleted.
    // The row itself stays so its audit history remains resolvable.
    purgedAt: v.optional(v.number()),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_live_created", ["userId", "archivedAt", "createdAt"])
    .index("by_user_hash", ["userId", "sha256"])
    .index("by_raw_storage", ["rawStorageId"])
    .index("by_storage", ["storageId"])
    .index("by_preview", ["previewId"])
    .index("by_thumb", ["thumbId"])
    .index("by_hash", ["sha256"])
    .index("by_status_started", ["status", "processingStartedAt"])
    .index("by_status_scoring_started", ["status", "scoringStartedAt"])
    .index("by_status_created", ["status", "createdAt"])
    // Retention sweep: archived rows whose objects are still stored, in
    // archive order. `purgedAt` leads so the sweep's equality on it excludes
    // purged rows structurally; live rows have no `archivedAt` and sort before
    // every number, so the range `.gt("archivedAt", 0)` skips them.
    .index("by_unpurged_archived", ["purgedAt", "archivedAt"]),

  scores: defineTable({
    sha256: v.string(),
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
    detail: v.optional(jsonRecord),
    // True for image-describing outcomes (see `CACHEABLE` in
    // internal/scoring.ts); false for `unavailable`. Part of the cache index so
    // the lookup reads at most the one cacheable row and never scans outage
    // history.
    cacheable: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_cache_entry", ["sha256", "provider", "configVersion", "cacheable"])
    .index("by_sha", ["sha256"]),

  scoringAttempts: defineTable({
    imageId: v.id("images"),
    provider,
    outcome: scoringOutcome,
    errorCode: v.optional(v.string()),
    latencyMs: v.number(),
    at: v.number(),
  }).index("by_image_at", ["imageId", "at"]),

  auditEvents: defineTable({
    actorId: v.string(),
    action: auditAction,
    table: v.string(),
    docId: v.string(),
    before: v.optional(jsonRecord),
    after: v.optional(jsonRecord),
    at: v.number(),
  })
    .index("by_doc", ["docId", "at"])
    .index("by_actor", ["actorId", "at"]),

  // Singleton rows for long-running maintenance jobs. `storageSweep` stores the
  // `_creationTime` of the last `_storage` object already checked.
  maintenance: defineTable({
    key: v.string(),
    watermark: v.number(),
  }).index("by_key", ["key"]),
});