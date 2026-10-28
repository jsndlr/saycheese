export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
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