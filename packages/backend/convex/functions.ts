import type { GenericCtx } from "@convex-dev/better-auth";
import { can, type Permission } from "@saycheese/core/access";
import { errorPayload, type ErrorCode } from "@saycheese/core/errors";
import { zCustomMutation, zCustomQuery } from "convex-helpers/server/zod4";
import { ConvexError } from "convex/values";

import type { DataModel } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./authComponent";

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
};

type AuthedCtx = { user: AuthedUser };

function fail(code: ErrorCode): never {
  const payload = errorPayload(code);
  throw new ConvexError({ code: payload.code, message: payload.message });
}

function rolesOf(user: object): string[] {
  if (!("role" in user)) {
    return ["user"];
  }
  const { role } = user;
  return typeof role === "string" ? [role] : ["user"];
}

async function resolveUser(ctx: GenericCtx<DataModel>): Promise<AuthedUser> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    return fail("AUTH_REQUIRED");
  }
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    roles: rolesOf(user),
  };
}

async function authorize(
  ctx: GenericCtx<DataModel>,
  permission: Permission,
): Promise<AuthedCtx> {
  const user = await resolveUser(ctx);
  if (!can(user.roles, permission)) {
    return fail("FORBIDDEN");
  }
  return { user };
}

/**
 * Signed-in query. `permission` is part of the definition, so omitting it is a
 * type error; the handler reads the resolved user from `ctx.user`.
 */
export const authedQuery = zCustomQuery(query, {
  args: {},
  input: async (ctx, _args, extra: { permission: Permission }) => {
    const { user } = await authorize(ctx, extra.permission);
    return { ctx: { user }, args: {} };
  },
});

/**
 * Signed-in mutation. Same contract as `authedQuery`.
 */
export const authedMutation = zCustomMutation(mutation, {
  args: {},
  input: async (ctx, _args, extra: { permission: Permission }) => {
    const { user } = await authorize(ctx, extra.permission);
    return { ctx: { user }, args: {} };
  },
});

/**
 * Deliberately unauthenticated query. The `access: "public"` marker is
 * required by the definition type, so public reads stay greppable.
 */
export const publicQuery = zCustomQuery(query, {
  args: {},
  input: (_ctx, _args, _extra: { access: "public" }) => ({ ctx: {}, args: {} }),
});
