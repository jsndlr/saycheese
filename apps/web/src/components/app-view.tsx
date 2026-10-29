"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import { Button } from "@saycheese/ui/components/button";
import { preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { usePreloadedQuery } from "convex/react";
import { useState } from "react";

import { AuthGate } from "@/components/auth-gate";
import { ImageHistory } from "@/components/image-history";
import { Uploader } from "@/components/uploader";
import { authClient } from "@/lib/auth-client";
import { UPLOAD_COPY } from "@/lib/copy";

const SIGN_OUT_ERROR = "Could not sign out. Check your connection and try again.";

function AccountDetails({
  email,
  release,
  signOutError,
  onSignOut,
  preloadedImages,
}: {
  email: string;
  release: string;
  signOutError: string | null;
  onSignOut: () => void;
  preloadedImages: Preloaded<typeof api.queries.images.list>;
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
        <ImageHistory preloaded={preloadedImages} next="/app" />
      </div>
    </div>
  );
}

/**
 * The preloaded branch. It subscribes to nothing, so it is safe to paint while
 * Convex auth is still resolving — or before the browser has a token at all.
 */
function PreloadedAccountDetails({
  preloaded,
  preloadedImages,
  signOutError,
  onSignOut,
}: {
  preloaded: Preloaded<typeof api.queries.me.current>;
  preloadedImages: Preloaded<typeof api.queries.images.list>;
  signOutError: string | null;
  onSignOut: () => void;
}) {
  const initial = preloadedQueryResult(preloaded);

  return (
    <AccountDetails
      email={initial.user.email}
      release={initial.release}
      signOutError={signOutError}
      onSignOut={onSignOut}
      preloadedImages={preloadedImages}
    />
  );
}

function SubscribedAccountDetails({
  preloaded,
  preloadedImages,
  signOutError,
  onSignOut,
}: {
  preloaded: Preloaded<typeof api.queries.me.current>;
  preloadedImages: Preloaded<typeof api.queries.images.list>;
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
      preloadedImages={preloadedImages}
    />
  );
}

export default function AppView({
  preloaded,
  preloadedImages,
}: {
  preloaded: Preloaded<typeof api.queries.me.current>;
  preloadedImages: Preloaded<typeof api.queries.images.list>;
}) {
  // Set synchronously before the session is cleared so the authed subscription
  // unmounts instead of re-running as an unauthenticated query.
  const [leaving, setLeaving] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

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
    // AuthGate sees the cleared session and replaces the route with sign-in.
  }

  return (
    <AuthGate
      next="/app"
      fallback={
        <PreloadedAccountDetails
          preloaded={preloaded}
          preloadedImages={preloadedImages}
          signOutError={signOutError}
          onSignOut={handleSignOut}
        />
      }
    >
      {leaving ? null : (
        <SubscribedAccountDetails
          preloaded={preloaded}
          preloadedImages={preloadedImages}
          signOutError={signOutError}
          onSignOut={handleSignOut}
        />
      )}
    </AuthGate>
  );
}
