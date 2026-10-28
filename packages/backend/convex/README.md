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

## Seeding a development deployment

`pnpm seed` (from the repo root) runs `internal/seed:run` against the
deployment configured in `packages/backend/.env.local`:

```bash
pnpm seed
# convex run internal/seed:run
```

It creates:

- a Better Auth email/password account `demo@saycheese.dev` (password
  `saycheese-demo-2026`, or `SEED_DEMO_PASSWORD` when set) that can sign in
  through the normal form;
- five images for that account, newest first: a scored image (score 82), a
  `no_face` image, a `multiple_faces` image, a pending `uploaded` image, and a
  `failed` image with `IMAGE_CORRUPT`. The scored images carry a `scores` row
  (`provider: "stub"`, `providerModel: "stub-v1"`); variants are 1600/512/160
  WebP at quality 82 from a 1200x900 PNG source.

It is idempotent: the account is looked up by email, image bytes are generated
deterministically, and an image whose `(userId, sha256)` already exists is
skipped. A second run creates no user, rows or storage objects and returns
`{ "userCreated": false, "imagesCreated": 0, "imagesSkipped": 5 }`; any object
stored for a row that raced into existence is deleted.

**Dev-only guard:** the action throws before writing anything unless `SITE_URL`
is an `http://localhost` or `http://127.0.0.1` URL. Production uses the https
Vercel URL, so production can never be seeded. The seed never writes password
hashes itself: it calls Better Auth's `signUpEmail` API.

The Node action renders the PNG/WebP bytes with `sharp`; the database rows are
written by `internal/seedData:commit`, which is edge-safe and covered by
`test/seed.test.ts` with pre-stored fixture blobs.
