# Convex functions

The function contract lives in `functions.ts`. It is the only module that may
import `query`, `mutation` or `action` from `./_generated/server` (ESLint
enforces this), so every function goes through auth and permissions.

- `authedQuery` / `authedMutation` — signed-in only. `permission` is required by
  the type and is checked with `can(roles, permission)` from `@saycheese/core`;
  the handler receives `ctx.user` (`id`, `email`, `name`, `roles`) and must not
  call `ctx.auth` itself.
- `publicQuery` — unauthenticated reads only. Requires `access: "public"` so the
  exemption is explicit and greppable.
- `internalQuery`, `internalMutation`, `internalAction`, `httpAction` — import
  directly from `./_generated/server` when needed.

```ts
// convex/images.ts
import { authedQuery } from "./functions";

export const get = authedQuery({
  args: {},
  permission: { resource: "image", action: "read" },
  handler: async (ctx) => {
    return await ctx.db.query("images").first();
  },
});
```

Environment variables are read only through `env` from `./env`, which validates
them with Zod at module load.
