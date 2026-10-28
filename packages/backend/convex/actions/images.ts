"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { validateImage } from "../lib/imageValidation";

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

    let bytes: Uint8Array;
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

    // TODO(task 2): re-encode variants, persist width/height, mark ready.
  },
});