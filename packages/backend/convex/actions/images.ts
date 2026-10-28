"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import {
  encodeVariants,
  type EncodedVariant,
  type EncodedVariants,
} from "../lib/imageEncoding";
import { validateImage } from "../lib/imageValidation";

/**
 * Storage ids for the three published variants.
 */
type StoredVariants = {
  storageId: Id<"_storage">;
  previewId: Id<"_storage">;
  thumbId: Id<"_storage">;
};

/**
 * Stores the three WebP variants. Objects already stored when a later store
 * throws are deleted here: an action-side delete persists even though the
 * action fails, so no partial set is left behind.
 */
async function storeVariants(
  ctx: ActionCtx,
  variants: EncodedVariants["variants"],
): Promise<StoredVariants> {
  const stored: Id<"_storage">[] = [];
  const store = async (variant: EncodedVariant): Promise<Id<"_storage">> => {
    const id = await ctx.storage.store(
      new Blob([new Uint8Array(variant.bytes)], { type: "image/webp" }),
    );
    stored.push(id);
    return id;
  };

  try {
    const storageId = await store(variants.original);
    const previewId = await store(variants.preview);
    const thumbId = await store(variants.thumb);
    return { storageId, previewId, thumbId };
  } catch (error) {
    await Promise.all(stored.map((id) => ctx.storage.delete(id)));
    throw error;
  }
}

export const process = internalAction({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) => {
    const claim = await ctx.runMutation(
      internal.internal.images.claimForProcessing,
      { imageId },
    );
    // Already claimed, already failed or gone: a retry must not redo anything.
    if (claim === null) {
      return;
    }

    let bytes: Buffer;
    try {
      const blob = await ctx.storage.get(claim.rawStorageId);
      if (blob === null) {
        await ctx.runMutation(internal.internal.images.markFailed, {
          imageId,
          code: "IMAGE_CORRUPT",
        });
        return;
      }
      // Buffer, not Uint8Array: sharp only accepts host-realm typed arrays, and
      // the test harness runs this action inside the edge-runtime realm.
      bytes = Buffer.from(await blob.arrayBuffer());
    } catch (error) {
      await ctx.runMutation(internal.internal.images.markFailed, {
        imageId,
        code: "IMAGE_CORRUPT",
      });
      console.log(
        JSON.stringify({
          event: "image.process.read_failed",
          imageId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    const result = await validateImage(bytes, claim.mime);
    if (!result.ok) {
      await ctx.runMutation(internal.internal.images.markFailed, {
        imageId,
        code: result.code,
      });
      console.log(
        JSON.stringify({
          event: "image.process.invalid",
          imageId,
          code: result.code,
        }),
      );
      return;
    }

    // Structured log only: ids and dimensions, never bytes or storage URLs.
    console.log(
      JSON.stringify({
        event: "image.process.validated",
        imageId,
        mime: result.sniffedMime,
        width: result.width,
        height: result.height,
        pages: result.pages,
      }),
    );

    let encoded: EncodedVariants;
    try {
      encoded = await encodeVariants(bytes);
    } catch (error) {
      await ctx.runMutation(internal.internal.images.markFailed, {
        imageId,
        code: "IMAGE_CORRUPT",
      });
      console.log(
        JSON.stringify({
          event: "image.process.encode_failed",
          imageId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    let stored: StoredVariants;
    try {
      stored = await storeVariants(ctx, encoded.variants);
    } catch (error) {
      // storeVariants already deleted any object it managed to store.
      await ctx.runMutation(internal.internal.images.markFailed, {
        imageId,
        code: "INTERNAL",
      });
      console.log(
        JSON.stringify({
          event: "image.process.store_failed",
          imageId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    const ready = await ctx.runMutation(internal.internal.images.markReady, {
      imageId,
      ...stored,
      width: encoded.width,
      height: encoded.height,
    });

    if (!ready) {
      // The row left `processing` while encoding (failed, archived, gone). The
      // mutation changed nothing, so its new objects are unreferenced.
      await Promise.all(
        Object.values(stored).map((id) => ctx.storage.delete(id)),
      );
      console.log(
        JSON.stringify({ event: "image.process.discarded", imageId }),
      );
      return;
    }

    // Structured log only: ids and sizes, never bytes or storage URLs.
    console.log(
      JSON.stringify({
        event: "image.process.ready",
        imageId,
        width: encoded.width,
        height: encoded.height,
        bytes: {
          original: encoded.variants.original.bytes.byteLength,
          preview: encoded.variants.preview.bytes.byteLength,
          thumb: encoded.variants.thumb.bytes.byteLength,
        },
      }),
    );

    // TODO(Phase 3): enqueue scoring
  },
});