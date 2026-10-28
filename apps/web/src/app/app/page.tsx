import { api } from "@saycheese/backend/convex/_generated/api";
import type { Preloaded } from "convex/react";
import { redirect } from "next/navigation";

import AppView from "@/components/app-view";
import { isAuthenticated, preloadAuthQuery } from "@/lib/auth-server";

/**
 * Production sanitizes Server Component errors (digest only), so the client
 * error boundary cannot see ConvexError data. Detect AUTH_REQUIRED here and
 * redirect before rendering.
 */
function isAuthRequiredError(error: unknown): boolean {
  if (error !== null && typeof error === "object" && "data" in error) {
    const { data } = error;
    if (
      typeof data === "object" &&
      data !== null &&
      "code" in data &&
      data.code === "AUTH_REQUIRED"
    ) {
      return true;
    }
  }
  return error instanceof Error && error.message.includes("AUTH_REQUIRED");
}

export default async function AppPage() {
  if (!(await isAuthenticated())) {
    redirect("/sign-in?next=/app");
  }

  let preloaded: Preloaded<typeof api.queries.me.current> | null = null;
  try {
    preloaded = await preloadAuthQuery(api.queries.me.current, {});
  } catch (error) {
    if (!isAuthRequiredError(error)) {
      throw error;
    }
  }

  // `redirect` throws, so it must run outside the catch block.
  if (preloaded === null) {
    redirect("/sign-in?next=/app");
  }

  return <AppView preloaded={preloaded} />;
}