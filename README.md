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

Copy environment variables from `packages/backend/.env.local` to `apps/*/.env`.

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

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

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
│   ├── web/         # Frontend application (Next.js)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── backend/     # Convex backend functions and schema
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:setup`: Setup and configure your Convex project
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run deploy:setup`: Link this repo to a Vercel project (first-time setup)
- `pnpm run dev:vercel`: Run the Vercel Services dev environment locally
- `pnpm run env:preview`: Sync local env files to the Vercel preview environment
- `pnpm run env:production`: Sync local env files to the Vercel production environment
- `pnpm run deploy`: Create a Vercel preview deployment
- `pnpm run deploy:prod`: Deploy to Vercel production
- `pnpm run deploy:check`: Dry-run a deploy to preview framework detection and included files without uploading
