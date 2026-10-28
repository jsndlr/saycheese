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
import { authedMutation, fail } from "../functions";
import { isStorageIdReferenced } from "../lib/storage";

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
    // Rate limit: Phase 3
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