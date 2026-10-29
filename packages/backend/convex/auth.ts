import { type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { ERROR_MESSAGES } from "@saycheese/core/errors";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";

import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { authComponent } from "./authComponent";
import authConfig from "./auth.config";
import { env } from "./env";
import { publicQuery } from "./functions";

/**
 * Normalised key for the per-email sign-in limit: Better Auth compares emails
 * case-insensitively, so `Ada@x` and `ada@x` must share one bucket.
 */
export function normalizeSignInEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim().toLowerCase();
  return email.length === 0 ? null : email;
}

/**
 * Constant-time string compare for the proxy secret. Length is not hidden, but
 * the byte loop does not leak where the first mismatch is.
 */
export function constantTimeEqual(left: string, right: string): boolean {
  let diff = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

/**
 * IP key for the sign-in limiter.
 *
 * `x-saycheese-client-ip` is only trusted when `x-saycheese-proxy-secret`
 * matches `AUTH_PROXY_SECRET`; the Next auth route sets both after stripping
 * anything the client sent. A direct caller of the Convex site can therefore
 * not rotate IPs, and without a configured secret every request shares the
 * `direct` bucket. The per-email key applies in every case.
 */
export function signInIpKey(
  headers: Headers | undefined,
  secret: string | undefined,
): string {
  if (secret === undefined || secret.length === 0) {
    return "direct";
  }
  const provided = headers?.get("x-saycheese-proxy-secret");
  if (provided === null || provided === undefined || !constantTimeEqual(provided, secret)) {
    return "direct";
  }
  const ip = headers?.get("x-saycheese-client-ip")?.trim();
  return ip !== undefined && ip.length > 0 ? ip : "direct";
}

/**
 * Sign-in limit. Better Auth's built-in limiter is not used: its
 * "database" storage calls `adapter.incrementOne`, which the Convex adapter
 * does not implement, so it would throw on every request. This hook enforces
 * the same rule in the Convex deployment and is not bypassable from the Next
 * proxy. It refuses with a 429 whose stable code is `TOO_MANY_REQUESTS`;
 * `apps/web/src/lib/auth-errors.ts` maps that to the core RATE_LIMITED copy.
 */
function signInRateLimit(ctx: GenericCtx<DataModel>) {
  return createAuthMiddleware(async (requestCtx) => {
    if (requestCtx.path !== "/sign-in/email") {
      return;
    }
    const email = normalizeSignInEmail(
      (requestCtx.body as { email?: unknown } | undefined)?.email,
    );
    if (email === null) {
      // Let Better Auth's own validation answer a malformed body.
      return;
    }
    if (!("runMutation" in ctx)) {
      // Sign-in always runs through an action context; a query context cannot
      // reach here and has no mutation runner.
      return;
    }
    const ipKey = signInIpKey(requestCtx.headers, env.AUTH_PROXY_SECRET);
    const status = await ctx.runMutation(internal.internal.authRateLimit.consume, {
      email,
      // "direct" means the address is unverified: the shared bucket covers it.
      ip: ipKey === "direct" ? null : ipKey,
    });
    if (status.ok) {
      return;
    }
    throw new APIError(
      "TOO_MANY_REQUESTS",
      {
        code: "TOO_MANY_REQUESTS",
        message: ERROR_MESSAGES.RATE_LIMITED,
      },
      { "X-Retry-After": String(Math.ceil(status.retryAfterMs / 1000)) },
    );
  });
}

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: env.SITE_URL,
    // The Next proxy forwards the browser's Origin unchanged, so every origin
    // the app is served from must be listed: preview deployments and any extra
    // hostname in TRUSTED_ORIGINS. Without this a preview build fails sign-in
    // with INVALID_ORIGIN, which the UI can only report as a generic error.
    trustedOrigins: [env.SITE_URL, ...(env.TRUSTED_ORIGINS ?? [])],
    database: authComponent.adapter(ctx),
    hooks: {
      before: signInRateLimit(ctx),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 200,
      requireEmailVerification: false,
    },
    emailVerification: {
      // Resend is the real transport; this console transport is for local development.
      sendOnSignUp: false,
      sendVerificationEmail: async ({ user, url }) => {
        const suffix = env.LOG_LEVEL === "debug" ? ` url=${url}` : "";
        console.info(`[auth] verification email for user ${user.id}: a mail would be sent${suffix}`);
      },
    },
    plugins: [
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  });
}

export { createAuth };

export const getCurrentUser = publicQuery({
  args: {},
  access: "public",
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    return user ?? null;
  },
});
