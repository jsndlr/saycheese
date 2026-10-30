"use client";

import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { signInPath } from "@/lib/auth-path";
import { useSigningOut } from "@/lib/sign-out";

/**
 * The only place that decides what a signed-out client renders.
 *
 * While Convex auth is resolving, `fallback` paints the server-preloaded
 * payload so the first frame is never blank. Once auth resolves, children
 * mount; if the session is lost later (expiry, sign-out in another tab) the
 * children unmount *before* their subscriptions can re-run without a token,
 * and the client is sent to sign-in with this path as `next`. The same holds
 * when this client starts the sign-out itself: children unmount first.
 */
export function AuthGate({
  next,
  fallback,
  children,
}: {
  next: string;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const signingOut = useSigningOut();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(signInPath(next));
    }
  }, [isAuthenticated, isLoading, next, router]);

  if (isLoading) {
    return <>{fallback}</>;
  }
  if (!isAuthenticated || signingOut) {
    return null;
  }
  return <>{children}</>;
}
