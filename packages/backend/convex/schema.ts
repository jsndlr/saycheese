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
    failureCode: v.optional(errorCode),
    scoreId: v.optional(v.id("scores")),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_live_created", ["userId", "archivedAt", "createdAt"])
    .index("by_user_hash", ["userId", "sha256"])
    .index("by_raw_storage", ["rawStorageId"])
    .index("by_storage", ["storageId"])
    .index("by_preview", ["previewId"])
    .index("by_thumb", ["thumbId"])
    .index("by_hash", ["sha256"])
    .index("by_status", ["status"]),

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
    createdAt: v.number(),
  })
    .index("by_cache", ["sha256", "provider", "configVersion"])
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
});