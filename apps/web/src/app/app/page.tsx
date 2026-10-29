import { api } from "@saycheese/backend/convex/_generated/api";
import type { Preloaded } from "convex/react";
import { redirect } from "next/navigation";

import AppView from "@/components/app-view";
import { signInPath } from "@/lib/auth-path";
import { isAuthenticated, preloadAuthQuery } from "@/lib/auth-server";
import { toUiError } from "@/lib/errors";

export default async function AppPage() {
  if (!(await isAuthenticated())) {
    redirect(signInPath("/app"));
  }

  let preloaded: Preloaded<typeof api.queries.me.current> | null = null;
  let preloadedImages: Preloaded<typeof api.queries.images.list> | null = null;
  try {
    preloaded = await preloadAuthQuery(api.queries.me.current, {});
    preloadedImages = await preloadAuthQuery(api.queries.images.list, {
      paginationOpts: { numItems: 12, cursor: null },
    });
  } catch (error) {
    if (toUiError(error).code !== "AUTH_REQUIRED") {
      throw error;
    }
  }

  // `redirect` throws, so it must run outside the catch block.
  if (preloaded === null || preloadedImages === null) {
    redirect(signInPath("/app"));
  }

  return <AppView preloaded={preloaded} preloadedImages={preloadedImages} />;
}