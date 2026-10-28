import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * True when any images row owns this storage object. Every field that can point
 * at `_storage` is checked, not just the raw upload: the process action replaces
 * `rawStorageId` with `storageId`, `previewId` and `thumbId`, and later phases
 * (plus the orphan sweep) must never treat a live variant as an orphan.
 *
 * The orphan sweep only visits an object once (it advances a `_creationTime`
 * watermark past it), so any future code that removes a reference to a stored
 * object MUST delete that object itself. Dropping the reference alone would
 * leave the bytes in `_storage` forever because a later sweep skips them.
 */
export async function isStorageIdReferenced(
  ctx: QueryCtx,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const raw = await ctx.db
    .query("images")
    .withIndex("by_raw_storage", (q) => q.eq("rawStorageId", storageId))
    .first();
  if (raw !== null) {
    return true;
  }

  const processed = await ctx.db
    .query("images")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (processed !== null) {
    return true;
  }

  const preview = await ctx.db
    .query("images")
    .withIndex("by_preview", (q) => q.eq("previewId", storageId))
    .first();
  if (preview !== null) {
    return true;
  }

  const thumb = await ctx.db
    .query("images")
    .withIndex("by_thumb", (q) => q.eq("thumbId", storageId))
    .first();
  return thumb !== null;
}