import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { consumeSignIn } from "../lib/rateLimits";

/**
 * Sign-in limiter behind the Better Auth `hooks.before` guard. It lives in the
 * Convex deployment, so the limit cannot be bypassed by calling the Convex
 * HTTP endpoint directly (unlike a check in the Next.js proxy).
 *
 * `email` is already normalised by the hook; `ip` is the limiter key for the
 * client address (the literal "unknown" groups requests without one).
 */
export const consume = internalMutation({
  args: { email: v.string(), ip: v.string() },
  handler: async (ctx, { email, ip }) => {
    return await consumeSignIn(ctx, email, ip);
  },
});