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

## Scoring providers

`SMILE_PROVIDER` (`stub` by default) selects the adapter. The contract lives in
`lib/providers/types.ts`; adapters return raw `ProviderResult` faces and core
`mapProviderResult` derives the `SmileScore`. `lib/providers/index.ts` exposes
`providerFor(name, env)` and `providerOrder(env)` (plan 6.2: Rekognition falls
back to Vision; Vision and the stub do not fall back).

The Rekognition adapter (`lib/providers/rekognition.ts`) calls `DetectFaces`
with `Attributes: ["ALL"]` and signs the request with `aws4fetch`. The scoring
action (`actions/scoring.ts`, `"use node"`) converts the stored WebP variant to
JPEG before calling a provider that does not accept WebP. The Vision adapter is
not implemented yet; selecting it throws a fatal `ProviderError` with code
`adapter_unimplemented`.

### Deterministic stub (`stub-v1`)

No network, no randomness, no clock: every field is derived from the sha256, so
the same upload always yields the same result. Bucket by the first sha256 byte:

| byte 0    | share | mapped status                                        |
| --------- | ----- | ---------------------------------------------------- |
| 0x00–0x1F | 12.5% | `no_face`                                            |
| 0x20–0x3F | 12.5% | `multiple_faces` (dominant face + 1–2 smaller faces) |
| 0x40–0x4F | 6.25% | `low_quality` (face confidence 40–89)                |
| 0x50–0x5F | 6.25% | `low_quality` (sharpness 0–19)                       |
| 0x60–0xFF | 62.5% | `scored`, smile confidence 10–90                     |

Latency is 1–5 ms and `costMicros` is 0.

### Test-only sha256 prefixes

A sha256 starting with the 32-bit prefix `fa11face` triggers a test behaviour
instead of the bucket table. This keeps timeout/retry tests on the production
code path without mocking the provider. The next byte selects the behaviour:

| sha256 prefix           | effect                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `fa11face00`            | throws `ProviderError` kind `retryable`, code `stub_retryable` |
| `fa11face01`            | throws `ProviderError` kind `fatal`, code `stub_fatal`       |
| `fa11face02` + 4 hex ms | waits 0–65535 ms, then scores normally; rejects `AbortError` if aborted |
| `fa11face03`            | returns `ProviderResult.error` → mapped `unavailable`        |

A real upload hashes uniformly, so it hits the prefix with probability 2^-32
(about 1 in 4.3 billion). The delay variant only narrows that space further.

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
