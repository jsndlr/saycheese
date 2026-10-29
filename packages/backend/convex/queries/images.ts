import { paginationOptsValidator } from "convex/server";
import type { PaginationResult } from "convex/server";
import { convexToZod } from "convex-helpers/server/zod4";
import { z } from "zod";

import type { Id } from "../_generated/dataModel";
import { authedQuery, fail } from "../functions";
import type { ImageDto } from "../model/images";
import { ownedImage, toImageDto } from "../model/images";

/**
 * `paginationOptsValidator` is a Convex validator, so it is converted to the
 * Zod shape `zCustomQuery` expects. The conversion keeps the optional cursor
 * fields and rejects unknown ones.
 */
const paginationOpts = convexToZod(paginationOptsValidator);

/**
 * Image ids arrive as plain strings so a malformed id is a `NOT_FOUND` for the
 * caller, not a validator rejection. The validator runs before the handler and
 * its message is not part of the response in production, so an id such as
 * `/app/images/nonsense` would otherwise surface as an unclassified 500.
 */
const imageId = z.string().max(128);

async function resolveImageId(
  ctx: { db: { normalizeId: (table: "images", id: string) => Id<"images"> | null } },
  id: string,
): Promise<Id<"images">> {
  let normalized: Id<"images"> | null;
  try {
    normalized = ctx.db.normalizeId("images", id);
  } catch {
    normalized = null;
  }
  if (normalized === null) {
    return fail("NOT_FOUND");
  }
  return normalized;
}

export const list = authedQuery({
  args: { paginationOpts },
  permission: { resource: "image", action: "read" },
  handler: async (ctx, args): Promise<PaginationResult<ImageDto>> => {
    // `.eq("archivedAt", undefined)` matches documents where the optional
    // field is absent; archived rows carry a number and never match.
    const result = await ctx.db
      .query("images")
      .withIndex("by_user_live_created", (q) =>
        q.eq("userId", ctx.user.id).eq("archivedAt", undefined),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: await Promise.all(
        result.page.map((image) => toImageDto(ctx, image)),
      ),
    };
  },
});

export const byId = authedQuery({
  args: { id: imageId },
  permission: { resource: "image", action: "read" },
  handler: async (ctx, args): Promise<ImageDto> => {
    const id = await resolveImageId(ctx, args.id);
    return toImageDto(ctx, await ownedImage(ctx, id));
  },
});

export const fileUrl = authedQuery({
  args: {
    id: imageId,
    variant: z.enum(["original", "preview", "thumb"]),
  },
  permission: { resource: "image", action: "read" },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const id = await resolveImageId(ctx, args.id);
    const image = await ownedImage(ctx, id);
    const storageId =
      args.variant === "original"
        ? image.storageId
        : args.variant === "preview"
          ? image.previewId
          : image.thumbId;

    if (storageId === undefined) {
      return { url: null };
    }
    return { url: await ctx.storage.getUrl(storageId) };
  },
});
