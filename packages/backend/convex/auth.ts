import { type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";

import type { DataModel } from "./_generated/dataModel";
import { authComponent } from "./authComponent";
import authConfig from "./auth.config";
import { env } from "./env";
import { publicQuery } from "./functions";

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: env.SITE_URL,
    trustedOrigins: [env.SITE_URL],
    database: authComponent.adapter(ctx),
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
