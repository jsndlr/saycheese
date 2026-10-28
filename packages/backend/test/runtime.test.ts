import { register } from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { expect, it } from "vitest";

import schema from "../convex/schema";

// The real function tree plus one test-only module mapped into the root
// component. The fixture lives under test/ so it can never deploy.
const modules = {
  ...import.meta.glob("../convex/**/*.ts"),
  "../convex/testOnly.ts": () => import("./fixtures/forbidden"),
};

const currentUser = makeFunctionReference<"query">("queries/me:current");
const health = makeFunctionReference<"query">("healthCheck:get");
const audit = makeFunctionReference<"query">("testOnly:audit");

async function rejection(promise: Promise<unknown>): Promise<ConvexError<{ code: string; message: string }>> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    return error;
  }
  throw new Error("Expected the call to reject");
}

it("rejects an anonymous call with AUTH_REQUIRED", async () => {
  const t = convexTest(schema, modules);

  const error = await rejection(t.query(currentUser, {}));

  expect(error.data).toMatchObject({ code: "AUTH_REQUIRED" });
});

it("serves the public health check anonymously", async () => {
  const t = convexTest(schema, modules);

  await expect(t.query(health, {})).resolves.toBe("OK");
});

it("returns the signed-in user", async () => {
  const t = convexTest(schema, modules);
  const component = register(t, "betterAuth");
  const now = Date.now();

  const user = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Ada Lovelace",
          email: "ada@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );

  const session = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "session",
        data: {
          token: "test-token",
          userId: user._id,
          expiresAt: now + 60_000,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );

  const asUser = t.withIdentity({ subject: user._id, sessionId: session._id });

  const me = await asUser.query(currentUser, {});

  expect(me.user).toEqual({
    id: user._id,
    email: "ada@example.test",
    name: "Ada Lovelace",
  });
});

it("rejects a signed-in user without the required permission with FORBIDDEN", async () => {
  const t = convexTest(schema, modules);
  const component = register(t, "betterAuth");
  const now = Date.now();

  const user = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Grace Hopper",
          email: "grace@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );

  const session = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "session",
        data: {
          token: "test-token",
          userId: user._id,
          expiresAt: now + 60_000,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );

  const asUser = t.withIdentity({ subject: user._id, sessionId: session._id });

  const error = await rejection(asUser.query(audit, {}));

  expect(error.data).toMatchObject({ code: "FORBIDDEN" });
});