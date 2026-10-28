/**
 * Compile-time contract for the function builders. Never executed: `check-types`
 * compiles it, `vitest` only runs `*.test.ts`.
 */
import { authedMutation, authedQuery, publicQuery } from "../convex/functions";

export const authedRead = authedQuery({
  args: {},
  permission: { resource: "image", action: "read" },
  handler: async (ctx) => {
    const id: string = ctx.user.id;
    const roles: string[] = ctx.user.roles;
    return { id, roles };
  },
});

export const authedWrite = authedMutation({
  args: {},
  permission: { resource: "image", action: "create" },
  handler: async (ctx) => ctx.user.email,
});

// @ts-expect-error `permission` is required for authedQuery
export const missingPermission = authedQuery({
  args: {},
  handler: async (ctx) => ctx.user.id,
});

// @ts-expect-error `permission` is required for authedMutation
export const missingMutationPermission = authedMutation({
  args: {},
  handler: async (ctx) => ctx.user.id,
});

export const unknownAction = authedQuery({
  args: {},
  // @ts-expect-error "delete" is not an image action in the core statement
  permission: { resource: "image", action: "delete" },
  handler: async () => null,
});

export const unknownResource = authedQuery({
  args: {},
  // @ts-expect-error "photo" is not a resource in the core statement
  permission: { resource: "photo", action: "read" },
  handler: async () => null,
});

export const publicRead = publicQuery({
  args: {},
  access: "public",
  handler: async () => "OK",
});

// @ts-expect-error `access: "public"` is required to declare an unauthenticated read
export const undeclaredPublicRead = publicQuery({
  args: {},
  handler: async () => "OK",
});
