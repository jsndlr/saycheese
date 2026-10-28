"use node";

import { v } from "convex/values";

import { internalAction } from "../_generated/server";

/**
 * Phase 2 fills in decode, resize and score. The stub only records that the
 * job was reached; it never logs image bytes or URLs.
 */
export const process = internalAction({
  args: { imageId: v.id("images") },
  handler: async (_ctx, { imageId }) => {
    console.log(JSON.stringify({ event: "image.process.pending", imageId }));
  },
});