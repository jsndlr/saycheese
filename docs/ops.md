# Ops runbook

Short, factual runbook for running saycheese. It describes what exists today;
anything not in this file has not been set up yet.

## Environments

| Environment | Web | Convex | Notes |
| --- | --- | --- | --- |
| Local | `http://localhost:3001` (`pnpm dev:web`) | Dev deployment from `.env` | `pnpm seed` creates the demo account and five image states |
| Production | Vercel `web` service at the project domain | Production deployment configured in Vercel | Production deploys come only from a production Vercel build |

A production Vercel build deploys the backend and the web app together:
`scripts/vercel-build.sh` runs `convex deploy --cmd 'pnpm --filter web build'`
with `NEXT_PUBLIC_CONVEX_URL`, so the web build always points at the deployment
it just deployed. Preview builds never touch Convex.

## Health

- `GET /health` on the web app returns `{ ok, web: true, convex }` and proxies
  the Convex `/health` route with a 5 s timeout. A 503 means the web layer is up
  but Convex is unreachable or slow.
- `GET /health` on the Convex site URL returns `OK` when the deployment answers
  a trivial read.

Use the web route for uptime checks: it covers both layers. There is no external
uptime monitor or error tracker configured yet; server errors are written to the
Vercel logs as one JSON line each, with `"event":"request_error"`.

## Scheduled jobs

All three are Convex crons declared in `packages/backend/convex/crons.ts`.

| Job | Every | What it does |
| --- | --- | --- |
| `sweep orphan storage` | 1 hour | Deletes `_storage` objects that no row references |
| `sweep stuck images` | 10 minutes | Fails a row stuck in `processing` with `IMAGE_TIMEOUT`; settles a stale `scoring` row with an `unavailable` score |
| `purge archived images` | 24 hours | Deletes the files of images archived more than `ARCHIVE_RETENTION_MS` (30 days) ago and sets `purgedAt`; the row and its audit trail stay |

The orphan sweep visits each object once and never revisits it, so any new code
path that drops a storage reference must delete the object itself.

## Backup and restore

Convex is the only store (database plus file storage), so one export covers
everything.

```bash
cd packages/backend
npx convex export --prod --include-file-storage --path /path/to/backups/$(date +%F).zip
```

Store the archive off the machine and keep it out of the repository. Exports
include user images and are as sensitive as the deployment itself.

Restore into a deployment:

```bash
npx convex import --prod /path/to/backups/2026-10-29.zip
```

`--replace-all` overwrites every table in the target deployment. Treat it as a
destructive step and confirm before running it. There is no automatic backup
schedule; a manual export before each risky migration is the current policy.

## Secrets and rotation

Convex reads its config from the deployment environment validated by
`packages/backend/convex/env.ts`. The web app reads Vercel environment variables
and can sync the keys declared in `apps/web/.env.schema`:

```bash
pnpm env:production   # pushes apps/web/.env values to Vercel production
```

| Key | Where | Rotating it does |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` (min 32 chars) | Convex | Signs every user out; old session tokens stop verifying |
| `AUTH_PROXY_SECRET` (min 32, optional) | Convex and web | Proves the client IP header coming from the Next auth route; set it on both or neither |
| `SITE_URL` | Convex | Changes the trusted origin; a mismatch breaks sign-in |
| `AWS_*` / `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Convex | Provider credentials, only needed for `SMILE_PROVIDER=rekognition` or `vision` |
| `CONVEX_DEPLOY_KEY` | Vercel production env | Authorises production deploys from the Vercel build |
| `SEED_DEMO_PASSWORD` (dev only, min 12) | Local backend env | Password `pnpm seed` sets on the demo account |

Set a Convex value with `npx convex env set --prod KEY` (omit the value and it
prompts, so it never lands in shell history). After rotating a secret, redeploy
so running functions pick it up, and verify `/health` plus one sign-in.

## Incident checklist

1. `GET /health` on the web app. `convex: null` means the backend is unreachable
   from the web layer; a non-200 `convex` means Convex answered with an error.
2. Check the Vercel logs for `request_error` lines. They contain only the request method, router kind and route type; error text and request paths are excluded.
3. Read the Convex dashboard logs for the failing function. Scoring failures are
   already mapped to user copy in `packages/core/src/errors.ts`.
4. Failed uploads and scoring rows are cleaned by the sweeps above; a row that
   stays `processing` past 15 minutes is a bug, not a stuck job.
5. If the primary scoring provider is down, scoring falls back once to the next
   configured provider. A total outage surfaces as `SCORING_UNAVAILABLE`, the row
   settles `unavailable`, and a rescore is the retry.

## Dependency audit (2026-10-29)

`pnpm audit --prod` reported 13 advisories and now reports none. The fixes:

- Vitest 4.1.12 clears the Vitest, `@vitest/mocker` and tinypool advisories.
- `shadcn` (a build-time CSS import and CLI) moved to `devDependencies`, which takes `deepmerge` out of the production graph.
- Better Auth 1.7.14 clears the remaining Better Auth advisories (critical OAuth state and magic link, high OAuth proxy and device login, low Drizzle and Kysely adapters).

Better Auth 1.7 needs a patched adapter. `@convex-dev/better-auth` 0.12.6 is the latest release and declares `better-auth >=1.6.11 <1.7.0`, so `pnpm-workspace.yaml` allows 1.7.14 through `peerDependencyRules` and `patches/@convex-dev__better-auth@0.12.6.patch` changes it (in both `dist` and `src`, because the adapter's test helper loads `src`):

- `plugins/convex`: 1.7 removed `better-auth/plugins/oidc-provider`. The patch replaces it with a static stand-in that serves the discovery document at `/convex/.well-known/openid-configuration` and drops the plugin's after hooks. Convex uses a `customJwt` provider that reads `/convex/jwks`, so it never needs the plugin.
- `auth-options`: removes the `oidcProvider` entry from the schema-generation options. Its unused OIDC tables stay in the component schema.
- `client/adapter`: 1.7 adds a `modelKey` field to adapter arguments, which the component validators reject (JWKS returned 500). The patch strips it before every component call.

Verified on 2026-10-29 against the Convex dev deployment: `/convex/jwks` returns 200, and sign-up, sign-out and sign-in all work with Convex-authenticated queries.

When the adapter ships a release that supports Better Auth 1.7, remove the patch and the `peerDependencyRules` entry and re-run the audit.

Better Auth 1.6.18 and later collapse `useSession().data` to `never` in the adapter's `AuthClient` type ([get-convex/better-auth#420](https://github.com/get-convex/better-auth/issues/420)); 1.7.14 still does. `providers.tsx` casts the client to `AuthClient`; remove the cast once the adapter fixes the type.

Re-run the audit after dependency changes. Advisory counts are time-sensitive.
