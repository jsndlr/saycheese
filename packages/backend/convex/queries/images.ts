import { paginationOptsValidator } from "convex/server";
import type { PaginationResult } from "convex/server";
import { convexToZod, zid } from "convex-helpers/server/zod4";
import { z } from "zod";

import { authedQuery } from "../functions";
import type { ImageDto } from "../model/images";
import { ownedImage, toImageDto } from "../model/images";

/**
 * `paginationOptsValidator` is a Convex validator, so it is converted to the
 * Zod shape `zCustomQuery` expects. The conversion keeps the optional cursor
 * fields and rejects unknown ones.
 */
const paginationOpts = convexToZod(paginationOptsValidator);

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
  args: { id: zid("images") },
  permission: { resource: "image", action: "read" },
  handler: async (ctx, args): Promise<ImageDto> =>
    toImageDto(ctx, await ownedImage(ctx, args.id)),
});

export const fileUrl = authedQuery({
  args: {
    id: zid("images"),
    variant: z.enum(["original", "preview", "thumb"]),
  },
  permission: { resource: "image", action: "read" },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const image = await ownedImage(ctx, args.id);
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