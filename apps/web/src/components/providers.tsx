"use client";

import { type AuthClient, ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { Toaster } from "@saycheese/ui/components/sonner";
import { ConvexReactClient } from "convex/react";

import { authClient } from "@/lib/auth-client";

import { ENV } from "../env";
import { ThemeProvider } from "./theme-provider";

const convex = new ConvexReactClient(ENV.NEXT_PUBLIC_CONVEX_URL);

// better-auth >=1.6.18 collapses useSession().data to never in the adapter's AuthClient type,
// although 1.6.x is inside its declared peer range. Types only; drop the cast once fixed upstream.
// https://github.com/get-convex/better-auth/issues/420
const convexAuthClient = authClient as unknown as AuthClient;

export default function Providers({
  children,
  initialToken,
}: {
  children: React.ReactNode;
  initialToken?: string | null;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ConvexBetterAuthProvider client={convex} authClient={convexAuthClient} initialToken={initialToken}>
        {children}
      </ConvexBetterAuthProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
