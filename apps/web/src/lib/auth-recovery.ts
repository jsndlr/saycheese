import { signInPath } from "@/lib/auth-path";

const KEY = "saycheese:auth-recovery";
const WINDOW_MS = 15_000;

/**
 * A query can fail with AUTH_REQUIRED while the client still holds a token
 * for a session the server has already dropped (signed out elsewhere, or a
 * sign-in that kept the previous token). A full load fetches a fresh token
 * from the session cookie, so try that once; if it fails again inside the
 * window, the session is really gone and sign-in is the only way forward.
 */
export function recoverFromAuthError(pathname: string): void {
  let lastAttempt = 0;
  try {
    lastAttempt = Number(window.sessionStorage.getItem(KEY) ?? 0);
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage can be blocked; the sign-in fallback below still works.
    lastAttempt = Date.now();
  }

  if (Date.now() - lastAttempt > WINDOW_MS) {
    window.location.reload();
    return;
  }
  window.location.assign(signInPath(pathname));
}
