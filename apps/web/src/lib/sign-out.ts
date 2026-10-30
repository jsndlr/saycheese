import { useSyncExternalStore } from "react";

import { authClient } from "@/lib/auth-client";

export const SIGN_OUT_ERROR = "Could not sign out. Check your connection and try again.";

/**
 * Sign-out is started from the header menu, but the page underneath may hold
 * live subscriptions. `leaving` flips synchronously before the session is
 * cleared so those subscriptions unmount instead of re-running without a token.
 */
let leaving = false;
const listeners = new Set<() => void>();

function setLeaving(value: boolean) {
  leaving = value;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSigningOut() {
  return useSyncExternalStore(
    subscribe,
    () => leaving,
    () => false,
  );
}

/** Called once the signed-out state is observed, so a later sign-in starts clean. */
export function resetSigningOut() {
  if (leaving) {
    setLeaving(false);
  }
}

/** Resolves to an error message, or null once the session is cleared. */
export async function signOutUser(): Promise<string | null> {
  setLeaving(true);
  try {
    const { error } = await authClient.signOut();
    if (error) {
      setLeaving(false);
      return SIGN_OUT_ERROR;
    }
  } catch {
    setLeaving(false);
    return SIGN_OUT_ERROR;
  }
  // The auth gate sees the cleared session and replaces the route with sign-in.
  return null;
}
