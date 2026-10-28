"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import { Button } from "@saycheese/ui/components/button";
import { preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { useConvexAuth, usePreloadedQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

const SIGN_OUT_ERROR = "Could not sign out. Check your connection and try again.";

function AccountDetails({
  email,
  release,
  signOutError,
  onSignOut,
}: {
  email: string;
  release: string;
  signOutError: string | null;
  onSignOut: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Your account</h1>
      <p className="text-muted-foreground">{email}</p>
      <p className="mt-1 text-xs text-muted-foreground">Scoring config release {release}</p>
      <div className="mt-6 flex items-center gap-3">
        <Button type="button" variant="outline" onClick={onSignOut}>
          Sign out
        </Button>
        {signOutError ? (
          <p role="alert" className="text-sm text-destructive">
            {signOutError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SubscribedAccountDetails({
  preloaded,
  signOutError,
  onSignOut,
}: {
  preloaded: Preloaded<typeof api.queries.me.current>;
  signOutError: string | null;
  onSignOut: () => void;
}) {
  const { user, release } = usePreloadedQuery(preloaded);

  return (
    <AccountDetails
      email={user.email}
      release={release}
      signOutError={signOutError}
      onSignOut={onSignOut}
    />
  );
}

export default function AppView({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.queries.me.current>;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  // Set synchronously before the session is cleared so the authed subscription
  // unmounts instead of re-running as an unauthenticated query.
  const [leaving, setLeaving] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/sign-in?next=/app");
    }
  }, [isAuthenticated, isLoading, router]);

  async function handleSignOut() {
    setSignOutError(null);
    setLeaving(true);

    try {
      const { error } = await authClient.signOut();
      if (error) {
        setLeaving(false);
        setSignOutError(SIGN_OUT_ERROR);
        return;
      }
    } catch {
      setLeaving(false);
      setSignOutError(SIGN_OUT_ERROR);
      return;
    }

    router.replace("/sign-in");
    router.refresh();
  }

  if (leaving) {
    return null;
  }

  // While Convex auth is still loading, paint the server-preloaded payload
  // without subscribing, so the email is visible on the first frame.
  if (isLoading) {
    const initial = preloadedQueryResult(preloaded);
    return (
      <AccountDetails
        email={initial.user.email}
        release={initial.release}
        signOutError={signOutError}
        onSignOut={handleSignOut}
      />
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SubscribedAccountDetails
      preloaded={preloaded}
      signOutError={signOutError}
      onSignOut={handleSignOut}
    />
  );
}