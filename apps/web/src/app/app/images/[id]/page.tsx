import { api } from "@saycheese/backend/convex/_generated/api";
import type { Preloaded } from "convex/react";
import { notFound, redirect } from "next/navigation";

import ImageDetail from "@/components/image-detail";
import { signInPath } from "@/lib/auth-path";
import { isAuthenticated, preloadAuthQuery } from "@/lib/auth-server";
import { toUiError } from "@/lib/errors";
import { isImageNotFoundError } from "@/lib/image-not-found";

type ImagePageParams = Promise<{ id: string }>;

export default async function ImagePage({
  params,
}: {
  params: ImagePageParams;
}) {
  const { id } = await params;
  const path = `/app/images/${id}`;
  const signIn = signInPath(path);

  if (!(await isAuthenticated())) {
    redirect(signIn);
  }

  let preloaded: Preloaded<typeof api.queries.images.byId> | null = null;
  let preloadedOriginal: Preloaded<typeof api.queries.images.fileUrl> | null =
    null;
  let missing = false;

  try {
    // The original URL is preloaded too: the score panel then reserves and
    // paints the preview on the first frame instead of shifting the panel when
    // the storage URL arrives.
    [preloaded, preloadedOriginal] = await Promise.all([
      preloadAuthQuery(api.queries.images.byId, { id }),
      preloadAuthQuery(api.queries.images.fileUrl, {
        id,
        variant: "original",
      }),
    ]);
  } catch (error) {
    if (toUiError(error).code === "AUTH_REQUIRED") {
      // The redirect below handles an expired session.
    } else if (isImageNotFoundError(error)) {
      missing = true;
    } else {
      throw error;
    }
  }

  // `notFound` and `redirect` throw, so they must run outside the catch block.
  if (missing) {
    notFound();
  }
  if (preloaded === null || preloadedOriginal === null) {
    redirect(signIn);
  }

  return (
    <ImageDetail
      preloaded={preloaded}
      preloadedOriginal={preloadedOriginal}
      next={path}
    />
  );
}
