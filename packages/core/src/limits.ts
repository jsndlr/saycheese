export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * `ctx.storage.generateUploadUrl()` links expire after one hour
 * (https://docs.convex.dev/file-storage/upload-files#generating-the-upload-url).
 */
export const UPLOAD_URL_TTL_MS = 60 * 60 * 1000;

/**
 * Extra slack on top of the upload URL lifetime before a stored object is
 * refused at commit. Covers upload completion racing the URL's expiry and
 * small clock skew between the upload and the commit mutation.
 */
export const UPLOAD_COMMIT_GRACE_MS = 15 * 60 * 1000;

/**
 * Accepted upload MIME types. Mirrors the `UNSUPPORTED_MEDIA_TYPE` message in
 * `errors.ts`; all three are decodable by sharp.
 */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

export function isAllowedImageMime(value: string): value is ImageMime {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * HEIC/HEIF declarations are answered with `HEIC_UNSUPPORTED` rather than the
 * generic unsupported-media error. The prebuilt sharp/libvips binary cannot
 * decode HEVC-coded HEIC (`heif: Error while loading plugin`), so the format is
 * rejected before an upload row exists. See "Supported images" in the README.
 */
export const HEIC_MIME_TYPES = [
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
] as const;

export function isHeicMime(value: string): boolean {
  return (HEIC_MIME_TYPES as readonly string[]).includes(value);
}

export const MAX_PIXELS = 20_000_000;
export const MAX_EDGE = 8192;
export const MIN_EDGE = 64;

export const VARIANTS = [
  { name: "large", edge: 1600 },
  { name: "medium", edge: 512 },
  { name: "thumb", edge: 160 },
] as const;

export type VariantName = (typeof VARIANTS)[number]["name"];

export const WEBP_QUALITY = 82;

export const RATE_LIMITS = {
  signIn: { limit: 10, windowMs: 15 * 60_000 },
  upload: { limit: 30, windowMs: 60 * 60_000 },
  rescore: { limit: 10, windowMs: 60 * 60_000 },
  score: { limit: 100, windowMs: 24 * 60 * 60_000 },
} as const;

/**
 * How long an image may sit in `processing` (or in `uploaded` without its
 * scheduled process action ever starting) before the stuck sweep fails it.
 *
 * Convex caps Node runtime action execution at 10 minutes
 * (https://docs.convex.dev/production/state/limits#execution-time-and-scheduling),
 * so a row older than this cannot still have a live action behind it.
 */
export const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * How long an image may sit in `scoring` before the stuck sweep records an
 * `unavailable` score.
 *
 * One score action is bounded by 10 s (6 s per provider call, one retry), so
 * five minutes is 30× that budget: enough for a temporary provider outage,
 * a workpool backlog or a crashed action, while still converging the UI long
 * before the hourly maintenance cadence becomes noticeable.
 */
export const SCORING_TIMEOUT_MS = 5 * 60 * 1000;

export function exceedsByteCap(bytes: number): boolean {
  return bytes > MAX_UPLOAD_BYTES;
}

export function dimensionViolation(
  width: number,
  height: number,
): "IMAGE_TOO_LARGE" | "IMAGE_TOO_SMALL" | null {
  // Non-finite values fail both comparisons below, so they are classified explicitly.
  if (!Number.isFinite(width) || !Number.isFinite(height)) return "IMAGE_TOO_SMALL";
  if (width <= 0 || height <= 0) return "IMAGE_TOO_SMALL";
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    return "IMAGE_TOO_LARGE";
  }
  if (width < MIN_EDGE || height < MIN_EDGE) return "IMAGE_TOO_SMALL";
  return null;
}