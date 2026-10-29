# saycheese

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Convex, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Convex** - Reactive backend-as-a-service platform
- **Authentication** - Better-Auth

## Supported images

### Allowlist and limits

Accepted upload types are JPEG, PNG and WebP. Everything else is rejected.

- **8 MiB** maximum upload (`8 * 1024 * 1024` bytes, checked at upload commit and again while processing).
- **20 megapixels** maximum, **8192 px** maximum longest edge, **64 px** minimum on both edges.
- **Single frame only.** Animated WebP and APNG are rejected; the image is not flattened to its first frame.

The client's declared MIME type is checked at commit, but the bytes are authoritative: processing sniffs magic bytes and rejects a file whose content does not match an allowlisted format. AVIF is not in the allowlist.

### What happens to an accepted image

EXIF orientation is applied before resizing. The decoded pixels are re-encoded as WebP (quality 82) at three edges: 1600 (`original`), 512 (`preview`) and 160 (`thumb`), never enlarged. No metadata is carried to the output, so EXIF (including GPS), XMP and ICC profiles are stripped, and trailing payloads such as a JPEG/PHP polyglot are dropped. Only the three generated WebP variants are ever served; the uploaded bytes are stored solely as processing input and are never exposed.

### HEIC/HEIF

**Rejected, deliberately.** On 2026-10-29 a real HEVC-coded HEIC (libheif's `examples/example.heic`, 1280x854) was probed against the repo's prebuilt sharp 0.35.5, which bundles libheif 1.23.5. `sharp.format.heif` lists only `.avif` as an input suffix, `metadata()` succeeds (`format: "heif"`, `compression: "hevc"`), but decoding fails with `heif: Error while loading plugin: Support for this compression format has not been built in: HEVC (a suitable decoder plugin is libde265)`. Convex runs the same prebuilt Linux binary, so accepting HEIC would only move the failure later; it is answered with the specific `HEIC_UNSUPPORTED` message ("Export the photo as JPEG"). `file-type` reports such a file as `{ ext: "heic", mime: "image/heif" }`, which is also caught when a HEIC is renamed to `.jpg`.

This decision would change with a custom libvips build that includes libde265 (or another HEVC decoder), or with client-side conversion to JPEG before upload. It would not change by allowlisting the MIME type alone.

### Hostile input matrix

| Input | Detection point | Outcome |
| --- | --- | --- |
| Upload over 8 MiB | Commit (also processing) | `PAYLOAD_TOO_LARGE`; no image row |
| Declared `image/heic`, `image/heif`, `image/heic-sequence` or `image/heif-sequence` | Commit | `HEIC_UNSUPPORTED` |
| HEIC/HEIF bytes declared as JPEG (renamed file) | Processing (magic bytes) | `HEIC_UNSUPPORTED`; row failed |
| GIF, SVG, PDF, AVIF or other non-allowlisted content | Commit (declared MIME) or processing (magic bytes) | `UNSUPPORTED_MEDIA_TYPE` |
| Declared MIME does not match sniffed bytes | Processing | `UNSUPPORTED_MEDIA_TYPE`; row failed |
| Animated WebP, or a 2-frame APNG | Processing | `ANIMATED_UNSUPPORTED` |
| Over 20 MP, or an edge over 8192 px | Processing, from the header before decode | `IMAGE_TOO_LARGE` |
| An edge under 64 px, or a zero dimension | Processing, from the header | `IMAGE_TOO_SMALL` |
| Truncated/fake image, decode failure, missing storage blob | Processing | `IMAGE_CORRUPT` |
| JPEG/PHP polyglot | Processing accepts the pixels; re-encode writes only decoded pixels | Stored WebP has no trailing payload; original bytes are never served |
| Same bytes uploaded again by the same user (same SHA-256) | Commit dedupe | Existing image returned with `deduplicated: true`; duplicate storage object deleted |
| Upload link older than its lifetime plus grace | Commit | `UPLOAD_EXPIRED` |
| Client-claimed byte count or SHA-256 disagrees with storage | Commit | `VALIDATION_FAILED` |
| Uploaded row never processed within 15 minutes | Stuck-image sweep | `IMAGE_TIMEOUT` |

## Archiving

Archiving hides a photo instead of deleting it. `commands.images.archive` sets `archivedAt` and writes one `image.archive` audit row (with the before/after status and `archivedAt`) in the same mutation. Every list and detail query filters on the live index, so an archived row reads as `NOT_FOUND` through `byId` and `fileUrl` and disappears from `list`. A second archive therefore answers `NOT_FOUND`; the operation is idempotent in effect, not in response. The command is refused with `VALIDATION_FAILED` while `uploaded`, `processing` or `scoring`: a scheduled action still holds the row and will write it. No rate limit applies (one owner-scoped field write, no provider work).

The storage objects survive for `ARCHIVE_RETENTION_MS` (30 days), so a mistaken archive stays recoverable inside that window. `internal/archiveSweep` then deletes the original, preview, thumb and raw objects, unsets those fields and sets `purgedAt`, keeping the row so the audit trail and score link stay resolvable. Rows are read through `images.by_unpurged_archived` with an equality on the missing `purgedAt`, so a purged row leaves the index range and is never reprocessed; a full batch reschedules, a partial one ends the chain. Linked `scores` rows are shared by content hash and are never touched.

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Convex Setup

This project uses Convex as a backend. You'll need to set up Convex before running the app:

```bash
pnpm run dev:setup
```

Follow the prompts to create a new Convex project and connect it to your application.

The web app reads its own public keys, so copy them under their public names: `CONVEX_URL` → `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_SITE_URL` → `NEXT_PUBLIC_CONVEX_SITE_URL` in `apps/web/.env.local`. A literal copy fails Varlock validation.

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Your app will connect to the Convex cloud backend automatically.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens (colors, radius) in `packages/ui/src/styles/tokens.css`
- Change the Tailwind theme mapping (fonts, `--color-*`, radius scale) in `packages/ui/src/styles/theme.css`
- Change imports, sources, and base layer in `packages/ui/src/styles/globals.css`
- Import icons from the barrel: `import { Moon } from "@saycheese/ui/lib/icons"` (`lucide-react` is only imported there)
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@saycheese/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

`apps/web` owns its environment schema in `.env.schema`; the backend validates its own variables in `packages/backend/convex/env.ts`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

### Auth proxy secret

`AUTH_PROXY_SECRET` (at least 32 characters) is shared by the Next auth route and the Convex deployment. The route (`apps/web/src/app/api/auth/[...all]/route.ts`) strips any client-sent `x-saycheese-*` headers, then sets `x-saycheese-client-ip` from the platform address and `x-saycheese-proxy-secret` from this value. Convex (`packages/backend/convex/auth.ts`) trusts the IP header only when the secret matches in constant time; otherwise the sign-in limiter keys every request under `direct`. The per-email key always applies. Set it in Vercel for production and preview and in the matching Convex deployment; when it is absent on Convex, all unproxied sign-ins share the `direct` bucket (safe default).

## Rate limits

Plan 6.3 uses `@convex-dev/rate-limiter` (`packages/backend/convex/lib/rateLimits.ts`): sign-in 10 per 15 min per normalised email and client IP (fixed window), upload and rescore 10/30 per hour per user (token bucket with the stated capacity), and scoring `SMILE_DAILY_QUOTA` per day per user (fixed window aligned to UTC midnight). Upload consumption is charged per committed upload (`commitUpload`), because one minted URL can be reused; `createUpload` has a separate, looser URL-minting limit. A dedupe hit creates nothing and does not consume. The daily score budget is consumed after the cache lookup, immediately before a provider call; a cache hit is free, and an exhausted budget settles the image as `scored` with an `unavailable` SCORING_QUOTA score, `quotaExceeded: true`, and its variants intact. Rescoring an image whose last score is an unavailable outage inside `SCORING_OUTAGE_WINDOW_MS` is refused with `SCORING_UNAVAILABLE` before the limiter: the rejection performs no provider work and does not spend the user's allowance.

## Smile scoring providers

The repository defaults to the deterministic stub (`SMILE_PROVIDER=stub`); it needs no network or credentials. AWS Rekognition is opt-in:

```bash
SMILE_PROVIDER=rekognition
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

The backend validates these keys at module load (`packages/backend/convex/env.ts`), so a missing key fails the push/call instead of a request. The IAM principal needs exactly one permission, `rekognition:DetectFaces`; no other Rekognition action is called. `DetectFaces` does not support resource-level permissions, so the resource is `*`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "rekognition:DetectFaces",
      "Resource": "*"
    }
  ]
}
```

Costs use `REKOGNITION_COST_MICROS_PER_IMAGE` in `packages/backend/convex/lib/providers/rekognition.ts`. The current value (1,000 micros = $0.001 per image) is a **labelled placeholder assumption, not a verified price**; confirm the DetectFaces list price for the deployment region in the AWS console before relying on `costMicros`. Scoring reads the stored WebP variant and converts it in memory to JPEG (quality 90, metadata stripped) before calling Rekognition, so the scoring action runs in Convex's Node runtime; Rekognition itself is signed with `aws4fetch`.

### Google Cloud Vision

Vision is opt-in and needs a service-account JSON holding `client_email`, `private_key` (PKCS#8 PEM) and optionally `token_uri`. Put the JSON (the whole file, as one value) in:

```bash
SMILE_PROVIDER=vision
GOOGLE_APPLICATION_CREDENTIALS_JSON='{"client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n..."}'
```

For the Rekognition-primary fallback the same variable is optional; without it the fallback is skipped and the run ends `unavailable`.

- Enable the **Cloud Vision API** in the service account's project and grant the account a role that allows `images.annotate` (for example `roles/cloudvision.user`).
- The adapter signs an RS256 service-account JWT for scope `https://www.googleapis.com/auth/cloud-vision`, exchanges it at the service account's token endpoint, and caches the access token in module scope until 60 s before expiry.
- Requests use `images:annotate` with `FACE_DETECTION`; accepted MIME types are JPEG, PNG and WebP. The stored WebP is sent unchanged.
- Vision reports `detectionConfidence` (0..1), which is scaled to core's 0..100, and a per-face `joyLikelihood`; the dominant face's likelihood maps through `VISION_JOY_SCORES` (`VERY_LIKELY` 90 down to `VERY_UNLIKELY` 10, `UNKNOWN` -> `low_quality`). Vision has no sharpness signal, so sharpness is left undefined and is not treated as low quality.
- Costs use `VISION_COST_MICROS_PER_IMAGE` (1,500 micros = $0.0015 per image). That value is a **labelled placeholder assumption, not a verified price**; confirm the FACE_DETECTION unit price for the billing project.
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` is required at module load when `SMILE_PROVIDER=vision`, and parsed as JSON. Token exchange failures are fatal.

### Fallback rules

With `SMILE_PROVIDER=rekognition` the order is Rekognition then Vision:

- The primary gets its normal single retry. If it ends in a retryable error or timeout, Vision gets one attempt within the same 10 s budget. Vision may retry once only when a full per-call timeout still fits after the retry wait.
- Fatal primary failures — bad credentials, invalid image, permission denied — do **not** fall back. A primary that cannot be constructed is recorded `unavailable` rather than silently routed to Vision; a misconfigured deployment must be visible.
- A Vision fallback that cannot be constructed (no credentials) is skipped. Every attempt is recorded in `scoringAttempts` with its provider; the score row names the provider that answered.
- The content cache is looked up once for the primary provider. If Vision answered, its row is keyed under `vision`; a later image with the same bytes misses the primary lookup and costs one extra call.

## Deployment

### Vercel Services

- Target: web
- Config: `vercel.json`
- Link the project first: pnpm run deploy:setup
- Local Vercel dev: pnpm run dev:vercel
- Sync preview env: pnpm run env:preview
- Sync production env: pnpm run env:production
- Dry-run check (no upload): pnpm run deploy:check
- Preview deploy: pnpm run deploy
- Production deploy: pnpm run deploy:prod
  Vercel Services share project environment variables, but deploys do not upload local `.env` files automatically. Link the project with `vercel link`, then run the env sync command before your first deploy (otherwise the deployment starts with no env vars), or pass one-off envs with `vercel deploy -e KEY=value`.
  Pass Vercel CLI flags to the env sync command directly, for example: `pnpm run env:production --scope your-team`.

For more details, see the guide on [Deploying to Vercel](https://www.better-t-stack.dev/docs/guides/vercel).

### Deploy

`scripts/vercel-build.sh` is the `web` service's build command:

- Pushing to `main` triggers a Vercel production build, which runs `convex deploy` (requires `CONVEX_DEPLOY_KEY` in the Vercel Production environment) and builds the web app inside that command with the resolved `NEXT_PUBLIC_CONVEX_URL`. A failed Convex schema push or invalid backend environment fails the deployment; Convex CLI 1.48 runs `--cmd` before the push, so the web build may run first.
- Preview deployments set `VERCEL_ENV=preview`, so no Convex deploy runs; the web app is built against the existing dev deployment from the Preview environment variables.
- Seeding never runs on production: `convex/internal/seed.ts` refuses any `SITE_URL` that is not `http://localhost`/`http://127.0.0.1`.

## Project Structure

```
saycheese/
├── apps/
│   └── web/         # Frontend application (Next.js)
├── packages/
│   ├── backend/     # Convex functions, schema and providers
│   ├── config/      # Shared TypeScript config
│   ├── core/        # Pure logic: errors, limits, scoring rules, validation
│   └── ui/          # Shared shadcn/ui components, tokens and styles
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:setup`: Setup and configure your Convex project
- `pnpm run check`: Lint and typecheck the workspace (the release gate)
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run test`: Run every package's test suite
- `pnpm run dev:server`: Start only the Convex backend
- `pnpm run seed`: Seed the dev deployment with the demo account and sample images
- `pnpm run env:generate`: Regenerate `src/env.ts` after changing an env schema
- `pnpm run deploy:setup`: Link this repo to a Vercel project (first-time setup)
- `pnpm run dev:vercel`: Run the Vercel Services dev environment locally
- `pnpm run env:preview`: Sync local env files to the Vercel preview environment
- `pnpm run env:production`: Sync local env files to the Vercel production environment
- `pnpm run deploy`: Create a Vercel preview deployment
- `pnpm run deploy:prod`: Deploy to Vercel production
- `pnpm run deploy:check`: Dry-run a deploy to preview framework detection and included files without uploading
