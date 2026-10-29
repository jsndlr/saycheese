import { RateLimiter } from "@convex-dev/rate-limiter";
import { RATE_LIMITS } from "@saycheese/core/limits";

import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { env } from "../env";
import { fail } from "../functions";

/**
 * Plan 6.3 rate limits. Every number comes from `RATE_LIMITS` in core (or
 * `SMILE_DAILY_QUOTA` for the daily score budget); nothing here is a magic
 * number.
 *
 * Kinds:
 * - sign-in: fixed 15-minute window. The threat is credential stuffing with
 *   many attempts; a fixed window counts all attempts in the window and gives
 *   a stable `retryAfterMs`.
 * - upload (commits) / uploadUrl / rescore: token bucket with
 *   `capacity === limit`. Each admits its full hourly allowance at once, then
 *   refills continuously. A plain fixed window would let a user double the
 *   allowance around a window boundary. URL minting gets twice the commit
 *   allowance because it creates nothing; the commit limit is the real cap.
 * - daily score: fixed 24-hour window aligned to UTC midnight (`start: 0`),
 *   because the quota is a calendar-style daily budget, not a burst
 *   allowance.
 *
 * `@convex-dev/rate-limiter` stores counters transactionally in its component,
 * so a rolled-back mutation does not consume a token.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter);

export type LimitName = "signIn" | "upload" | "uploadUrl" | "rescore";

export const LIMITS = {
  signIn: {
    kind: "fixed window",
    rate: RATE_LIMITS.signIn.limit,
    period: RATE_LIMITS.signIn.windowMs,
    start: 0,
  },
  upload: {
    kind: "token bucket",
    rate: RATE_LIMITS.upload.limit,
    period: RATE_LIMITS.upload.windowMs,
    capacity: RATE_LIMITS.upload.limit,
  },
  uploadUrl: {
    kind: "token bucket",
    rate: RATE_LIMITS.uploadUrl.limit,
    period: RATE_LIMITS.uploadUrl.windowMs,
    capacity: RATE_LIMITS.uploadUrl.limit,
  },
  rescore: {
    kind: "token bucket",
    rate: RATE_LIMITS.rescore.limit,
    period: RATE_LIMITS.rescore.windowMs,
    capacity: RATE_LIMITS.rescore.limit,
  },
} as const satisfies Record<LimitName, object>;

/**
 * The daily score budget is deployment-configurable, so its config is built at
 * call time instead of being frozen into `LIMITS`.
 */
export function dailyScoreLimit() {
  return {
    kind: "fixed window" as const,
    rate: env.SMILE_DAILY_QUOTA,
    period: RATE_LIMITS.score.windowMs,
    start: 0,
  };
}

function retryAfterMs(retryAfter: number | undefined): number {
  // A denied call always carries a positive retry hint; clamp so a client can
  // never read 0/undefined as "retry immediately".
  return Math.max(1, Math.ceil(retryAfter ?? 0));
}

/**
 * Consumes one token and throws the shared `RATE_LIMITED` ConvexError with
 * `detail.retryAfterMs` when the limit is exhausted.
 */
export async function consume(
  ctx: MutationCtx,
  name: LimitName,
  key: string,
): Promise<void> {
  const status = await rateLimiter.limit(ctx, name, {
    key,
    config: LIMITS[name],
  });
  if (!status.ok) {
    fail("RATE_LIMITED", { retryAfterMs: retryAfterMs(status.retryAfter) });
  }
}

/** Consumes the per-user daily provider budget. Returns the retry hint. */
export async function consumeDailyScore(
  ctx: MutationCtx,
  userId: string,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const status = await rateLimiter.limit(ctx, "dailyScore", {
    key: userId,
    config: dailyScoreLimit(),
  });
  if (status.ok) {
    return { ok: true };
  }
  return { ok: false, retryAfterMs: retryAfterMs(status.retryAfter) };
}

/**
 * Sign-in attempts count against both the normalised email and the client IP.
 * Two keys mean a single IP cannot spread attempts across many emails, and one
 * email cannot be attacked from many IPs. Both are consumed in one mutation.
 */
export async function consumeSignIn(
  ctx: MutationCtx,
  email: string,
  ip: string,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const emailStatus = await rateLimiter.limit(ctx, "signIn", {
    key: `email:${email}`,
    config: LIMITS.signIn,
  });
  const ipStatus = await rateLimiter.limit(ctx, "signIn", {
    key: `ip:${ip}`,
    config: LIMITS.signIn,
  });
  if (emailStatus.ok && ipStatus.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    retryAfterMs: Math.max(
      retryAfterMs(emailStatus.retryAfter),
      retryAfterMs(ipStatus.retryAfter),
    ),
  };
}