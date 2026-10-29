import { safeNextPath } from "@saycheese/core/validation";
import type { Route } from "next";

/**
 * The sign-in URL for a protected path. `safeNextPath` rejects absolute,
 * protocol-relative and encoded off-site targets, so a crafted `next` can
 * never leave the app. The result is percent-encoded because the sign-in page
 * reads it back from `searchParams` and validates it again.
 */
export function signInPath(next: string): Route {
  return `/sign-in?next=${encodeURIComponent(safeNextPath(next))}` as Route;
}
