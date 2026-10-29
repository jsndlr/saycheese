# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Everyday people using it for fun: someone takes a selfie, wants a quick smile score, retries with another photo and compares. Mobile and desktop, mostly short sessions. (Confirmed with the owner on 2026-10-29.)

## Product Purpose
saycheese rates the smile in an uploaded photo from 0 to 100. It checks faces first, so a photo with no face or several faces gets a clear answer instead of a score. Signed-in users keep a live history of their photos, can score a photo again, and can archive it. Success is a fast upload-to-score loop that feels playful and is easy to repeat.

## Positioning
A single-purpose smile scorer: upload, wait a few seconds, get a number and the reasons behind it. It scores the smile only, never the person.

## Operating Context
- Accepted uploads: JPEG, PNG and WebP, up to 8 MB. HEIC is rejected on purpose, with a message asking for a JPEG export.
- Photo states the UI must handle: uploading, processing, scoring, scored, no face, multiple faces, failed, and scoring temporarily unavailable.
- Archiving hides a photo and keeps its files for 30 days. Re-scoring is rate limited.
- Routes: `/` landing, `/sign-in`, `/sign-up`, `/app` (upload, score panel, history), `/app/images/[id]` (photo detail with Score again and Archive).
- Email and password sign-in only. Light and dark themes both ship.

## Capabilities and Constraints
- Scores are automated estimates and must be labelled as such: not a judgement of a person and not medical or dental advice (confirmed framing: "fun estimate, clearly labelled").
- Real scored photos, the live history and the score panel are the product; do not invent testimonials, user counts, accuracy claims or example scores presented as real results.
- Stack: Next.js 16, Tailwind 4, shadcn/ui primitives in `packages/ui`, Convex backend, Better Auth.
- Pricing, sharing and social features do not exist; do not imply them.

## Brand Commitments
The name is "saycheese". No logo, voice guide or palette has been supplied; none is binding yet.

## Evidence on Hand
No testimonials, press or usage data exist. Dev seed data (`pnpm seed`) provides the five photo states for demos only.

## Product Principles
- The photo and its score are the hero; chrome stays out of the way.
- Every state has an honest, specific message: what happened and what to do next.
- Playful in tone, modest in claims.
- Fast to repeat: the next upload is always one tap away.
- Works equally well one-handed on a phone and on a desktop.

## Accessibility & Inclusion
Keyboard operable with visible focus, sufficient contrast in both themes, reduced-motion respected, and score information never conveyed by color alone. Smile scoring touches how people feel about their faces, so copy stays kind.
