import type { GenericCtx } from "@convex-dev/better-auth";
import { can, type Permission } from "@saycheese/core/access";
import { errorPayload, type ErrorCode, type ErrorDetail } from "@saycheese/core/errors";
import { zCustomMutation, zCustomQuery } from "convex-helpers/server/zod4";
import { ConvexError, type Value } from "convex/values";

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

export function fail(code: ErrorCode, detail?: ErrorDetail): never {
  const payload = errorPayload(code, detail);
  throw new ConvexError({
    code: payload.code,
    message: payload.message,
    ...(payload.detail === undefined ? {} : { detail: payload.detail }),
  } as Value);
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

/**
 * Either a resource permission checked against the role grants, or the
 * explicit `"signed-in"` literal for reads that only need an authenticated
 * user (for example the caller's own profile).
 */
export type PermissionInput = Permission | "signed-in";

async function authorize(
  ctx: GenericCtx<DataModel>,
  permission: PermissionInput,
): Promise<AuthedCtx> {
  const user = await resolveUser(ctx);
  if (permission !== "signed-in" && !can(user.roles, permission)) {
    return fail("FORBIDDEN");
  }
  return { user };
}

/**
 * Metadata attached to every function produced by the builders below. The
 * architecture test reads it to prove that no public function skipped the
 * wrapper or forgot to declare a permission.
 */
export type WrapperName = "authedQuery" | "authedMutation" | "publicQuery";

export type WrapperMetadata = {
  wrapper: WrapperName;
  permission: PermissionInput | "public";
};

export const WRAPPER_MARKER: unique symbol = Symbol.for("saycheese.functionWrapper");

export function readWrapperMetadata(value: unknown): WrapperMetadata | undefined {
  if (typeof value !== "function" || !(WRAPPER_MARKER in value)) {
    return undefined;
  }
  const metadata = value[WRAPPER_MARKER];
  return isWrapperMetadata(metadata) ? metadata : undefined;
}

function isWrapperMetadata(value: unknown): value is WrapperMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("wrapper" in value) || !("permission" in value)) {
    return false;
  }
  const { wrapper, permission } = value;
  const knownWrapper =
    wrapper === "authedQuery" || wrapper === "authedMutation" || wrapper === "publicQuery";
  return knownWrapper && typeof permission !== "undefined";
}

type Definition = { permission?: PermissionInput; access?: "public" };

/**
 * Wraps a Convex builder so the registered function carries the marker. The
 * returned builder keeps the exact type and call behaviour of the original;
 * only a non-enumerable symbol property is added to the produced function.
 */
function withWrapperMetadata<Builder>(builder: Builder, wrapper: WrapperName): Builder {
  const tagged = (definition: Definition) => {
    const registered = (builder as unknown as (def: Definition) => object)(definition);
    const permission = wrapper === "publicQuery" ? "public" : definition.permission;
    if (permission === undefined) {
      throw new Error(`${wrapper} requires a permission`);
    }
    Object.defineProperty(registered, WRAPPER_MARKER, {
      value: Object.freeze({ wrapper, permission }),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return registered;
  };
  return tagged as unknown as Builder;
}

/**
 * Signed-in query. `permission` is part of the definition, so omitting it is a
 * type error; the handler reads the resolved user from `ctx.user`.
 */
export const authedQuery = withWrapperMetadata(
  zCustomQuery(query, {
    args: {},
    input: async (ctx, _args, extra: { permission: PermissionInput }) => {
      const { user } = await authorize(ctx, extra.permission);
      return { ctx: { user }, args: {} };
    },
  }),
  "authedQuery",
);

/**
 * Signed-in mutation. Same contract as `authedQuery`.
 */
export const authedMutation = withWrapperMetadata(
  zCustomMutation(mutation, {
    args: {},
    input: async (ctx, _args, extra: { permission: PermissionInput }) => {
      const { user } = await authorize(ctx, extra.permission);
      return { ctx: { user }, args: {} };
    },
  }),
  "authedMutation",
);

/**
 * Deliberately unauthenticated query. The `access: "public"` marker is
 * required by the definition type, so public reads stay greppable.
 */
export const publicQuery = withWrapperMetadata(
  zCustomQuery(query, {
    args: {},
    input: (_ctx, _args, _extra: { access: "public" }) => ({ ctx: {}, args: {} }),
  }),
  "publicQuery",
);
