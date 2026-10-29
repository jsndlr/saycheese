import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";

import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;

const consume = makeFunctionReference<
  "mutation",
  { email: string; ip: string },
  { ok: true } | { ok: false; retryAfterMs: number }
>("internal/authRateLimit:consume");

function harness(): Test {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

it("T-SEC-05: the 11th sign-in attempt for one email in 15 minutes is denied", async () => {
  const t = harness();
  const ip = "203.0.113.10";

  for (let index = 0; index < 10; index += 1) {
    expect(await t.mutation(consume, { email: "probe@example.test", ip })).toEqual({
      ok: true,
    });
  }

  // Case and surrounding whitespace are normalised by the hook, so the same
  // account cannot get a fresh bucket by changing its email casing.
  const denied = await t.mutation(consume, { email: "Probe@Example.Test", ip });
  expect(denied.ok).toBe(false);
  if (!denied.ok) {
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  }
});

it("sign-in limiter keys by IP as well as email", async () => {
  const t = harness();
  const ip = "203.0.113.11";
  for (let index = 0; index < 10; index += 1) {
    await t.mutation(consume, { email: `user${index}@example.test`, ip });
  }
  const denied = await t.mutation(consume, { email: "another@example.test", ip });
  expect(denied.ok).toBe(false);
});
