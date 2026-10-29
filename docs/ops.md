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

`pnpm audit --prod` reported 13 advisories. After upgrading Vitest to 4.1.12, Better Auth to 1.6.33 and `@convex-dev/better-auth` to 0.12.6, and moving `shadcn` (a build-time CSS import and CLI) to `devDependencies`, it reports 6, all in Better Auth: 1 critical, 2 high and 3 low. This is not a clean audit.

- Fixed: the Vitest, `@vitest/mocker` and tinypool advisories (Vitest 4 no longer uses tinypool), and the Better Auth device-login advisory patched in 1.6.22.
- Open: Better Auth GHSA-965c-763c-88jm (critical, OAuth state used as a magic link), GHSA-r4xp-prcw-77qf (high, OAuth proxy) and GHSA-q84f-53jg-9ppm (high, device login approval) are patched only in 1.7.x. GHSA-44jh-23m7-hpcf (low) concerns the Drizzle and Kysely adapters on PostgreSQL. saycheese enables email/password and the Convex plugin only, with no OAuth, OAuth proxy, magic-link or device plugins and the Convex database adapter. That narrows the exposure but is not proof of safety.
- Blocker: the latest `@convex-dev/better-auth` (0.12.6) declares `better-auth >=1.6.11 <1.7.0`. Tried 1.7.14 on 2026-10-29: it typechecks, but Convex cannot bundle the backend because the adapter imports `better-auth/plugins/oidc-provider`, which 1.7 no longer exports, and no standalone package replaces it. Do not force 1.7.x; upgrade when an adapter release supports it.
- Exposure: the adapter's Convex plugin only checks the `/magic-link/verify` path in its hooks and registers none of the vulnerable plugins; its `auth-options` helper that does list them is not imported by saycheese.
- Better Auth 1.6.18 and later collapse `useSession().data` to `never` in the adapter's `AuthClient` type ([get-convex/better-auth#420](https://github.com/get-convex/better-auth/issues/420)). `providers.tsx` casts the client to `AuthClient`; remove the cast once the adapter fixes the type.
- Deepmerge (low) came from `shadcn`, which has no patched version. `shadcn` is now a dev dependency, so `deepmerge` is out of the production graph.

Re-run the audit after dependency changes. Advisory counts are time-sensitive.
