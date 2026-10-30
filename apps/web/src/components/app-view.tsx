"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import { Button } from "@saycheese/ui/components/button";
import { preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { usePreloadedQuery } from "convex/react";
import { useState } from "react";

import { AuthGate } from "@/components/auth-gate";
import { ImageHistory } from "@/components/image-history";
import { UploadDock } from "@/components/upload-dock";
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
    <div className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 sm:px-6 sm:py-10">
      <h1 className="sr-only">saycheese</h1>
      <header className="mb-8 rounded-2xl bg-muted/70 px-3 py-2.5 sm:mb-10 sm:px-5 sm:py-3.5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-display text-base font-extrabold text-lamp uppercase sm:hidden"
          >
            {email.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="hidden text-xs text-muted-foreground sm:block">{UPLOAD_COPY.signedInAs}</p>
            <p className="truncate text-sm font-semibold">
              <span className="sr-only sm:hidden">{UPLOAD_COPY.signedInAs} </span>
              {email}
            </p>
            <p className="hidden text-xs text-muted-foreground sm:block">
              {UPLOAD_COPY.release(release)}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onSignOut}>
            {UPLOAD_COPY.signOut}
          </Button>
        </div>
        {signOutError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {signOutError}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-10 min-[900px]:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] min-[900px]:gap-14">
        <Uploader />
        <ImageHistory preloaded={preloadedImages} next="/app" />
      </div>
      <UploadDock />
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
