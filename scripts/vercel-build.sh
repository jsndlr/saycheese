#!/usr/bin/env bash
# Vercel build entrypoint for the `web` service (repo root).
#
# Production builds deploy the Convex backend and build the web app from inside
# `convex deploy --cmd`, so the web build receives the freshly resolved
# deployment URL. Note: Convex CLI 1.48 runs `--cmd` before the schema push;
# a failed push or invalid `packages/backend/convex/env.ts` still fails the
# Vercel deployment, but the Next.js build has already run by then.
# Preview and development builds never touch Convex; they only build the web app.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${VERCEL_ENV:-}" == "production" ]]; then
  if [[ -z "${CONVEX_DEPLOY_KEY:-}" ]]; then
    echo "vercel-build: VERCEL_ENV=production but CONVEX_DEPLOY_KEY is not set." >&2
    echo "vercel-build: add the production deploy key to the Vercel Production environment." >&2
    exit 1
  fi

  echo "vercel-build: production -> deploying Convex backend, then building web."
  cd packages/backend
  exec pnpm exec convex deploy \
    --cmd 'cd ../.. && pnpm --filter web build' \
    --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
fi

echo "vercel-build: VERCEL_ENV=${VERCEL_ENV:-unset} -> building web against the existing Convex deployment."
exec pnpm --filter web build