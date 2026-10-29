import type { Id } from "../_generated/dataModel";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fail } from "../functions";

type DbCtx = Pick<QueryCtx, "db">;
type OwnedCtx = DbCtx & { user: { id: string } };

/**
 * The only shape an image ever takes on the wire. Storage ids, ownership and
 * provider bookkeeping stay server-side: clients address images by `id` and
 * read pixels through the `fileUrl` query.
 */
export type ImageScoreDto = {
  score: number | null;
  confidence: number | null;
  status: Doc<"scores">["status"];
  reason: string;
  provider: Doc<"scores">["provider"];
  createdAt: number;
  // Per image, not per score: the linked score row is shared by every image
  // with the same `(sha256, provider, configVersion)`.
  cached: boolean;
};

export type ImageDto = {
  id: Id<"images">;
  sha256: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  status: Doc<"images">["status"];
  failureCode: NonNullable<Doc<"images">["failureCode"]> | null;
  quotaExceeded: boolean;
  createdAt: number;
  score: ImageScoreDto | null;
};

type OwnedOptions = { includeArchived?: boolean };

/**
 * Loads an image the caller owns. A missing row, another user's row and the
 * caller's archived row all fail identically, so an id can never be used to
 * probe for existence or ownership.
 */
export async function ownedImage(
  ctx: OwnedCtx,
  id: Id<"images">,
  { includeArchived = false }: OwnedOptions = {},
): Promise<Doc<"images">> {
  const image = await ctx.db.get("images", id);
  if (
    image === null ||
    image.userId !== ctx.user.id ||
    (!includeArchived && image.archivedAt !== undefined)
  ) {
    return fail("NOT_FOUND");
  }
  return image;
}

export async function toImageDto(
  ctx: DbCtx,
  image: Doc<"images">,
): Promise<ImageDto> {
  const score =
    image.scoreId === undefined
      ? null
      : await ctx.db.get("scores", image.scoreId);

  return {
    id: image._id,
    sha256: image.sha256,
    mime: image.mime,
    bytes: image.bytes,
    width: image.width ?? null,
    height: image.height ?? null,
    status: image.status,
    failureCode: image.failureCode ?? null,
    quotaExceeded: image.quotaExceeded ?? false,
    createdAt: image.createdAt,
    score:
      score === null
        ? null
        : {
            score: score.score,
            confidence: score.confidence,
            status: score.status,
            reason: score.reason,
            provider: score.provider,
            createdAt: score.createdAt,
            cached: image.scoreCached ?? false,
          },
  };
}