"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import { Button } from "@saycheese/ui/components/button";
import { preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { useConvexAuth, usePreloadedQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Uploader } from "@/components/uploader";
import { authClient } from "@/lib/auth-client";
import { UPLOAD_COPY } from "@/lib/copy";

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
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
      <h1 className="sr-only">saycheese</h1>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{UPLOAD_COPY.signedInAs}</p>
          <p className="break-words text-sm font-medium">{email}</p>
          <p className="text-xs text-muted-foreground">
            {UPLOAD_COPY.release(release)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={onSignOut}>
            {UPLOAD_COPY.signOut}
          </Button>
          {signOutError ? (
            <p role="alert" className="text-sm text-destructive">
              {signOutError}
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 min-[720px]:grid-cols-2">
        <Uploader />

        {/* Task 3 replaces this placeholder with the paginated history. */}
        <section aria-labelledby="history-heading" className="min-w-0">
          <h2 id="history-heading" className="mb-4 text-lg font-semibold">
            {UPLOAD_COPY.historyHeading}
          </h2>
          <div className="border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
            {UPLOAD_COPY.historyPlaceholder}
          </div>
        </section>
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