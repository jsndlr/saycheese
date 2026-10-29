import { api } from "@saycheese/backend/convex/_generated/api";
import type { Preloaded } from "convex/react";
import { redirect } from "next/navigation";

import AppView from "@/components/app-view";
import { isAuthenticated, preloadAuthQuery } from "@/lib/auth-server";
import { toUiError } from "@/lib/errors";

export default async function AppPage() {
  if (!(await isAuthenticated())) {
    redirect("/sign-in?next=/app");
  }

  let preloaded: Preloaded<typeof api.queries.me.current> | null = null;
  try {
    preloaded = await preloadAuthQuery(api.queries.me.current, {});
  } catch (error) {
    if (toUiError(error).code !== "AUTH_REQUIRED") {
      throw error;
    }
  }

  // `redirect` throws, so it must run outside the catch block.
  if (preloaded === null) {
    redirect("/sign-in?next=/app");
  }

  return <AppView preloaded={preloaded} />;
}