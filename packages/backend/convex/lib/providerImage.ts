"use node";

import sharp from "sharp";

import { ProviderError } from "./providers/types";

/**
 * Rekognition accepts JPEG and PNG only, while scoring always reads the
 * re-encoded WebP `original` variant. This helper produces the in-memory image
 * a provider accepts: unchanged when the MIME is accepted, otherwise a JPEG of
 * the same dimensions with no metadata.
 *
 * It runs once per action, before the retry loop, so retries reuse the same
 * bytes.
 */

/** Rekognition's per-image limit is 5 MB; the 1600 px variant is far below it. */
export const MAX_PROVIDER_IMAGE_BYTES = 5 * 1024 * 1024;

export type ProviderImage = {
  bytes: Uint8Array;
  mime: string;
};

export async function providerImage(
  bytes: Uint8Array,
  mime: string,
  acceptedMimes: readonly string[],
): Promise<ProviderImage> {
  if (acceptedMimes.includes(mime)) {
    return { bytes, mime };
  }

  // `jpeg()` drops metadata (no `withMetadata`) and keeps the pixel dimensions.
  const jpeg = await sharp(bytes).jpeg({ quality: 90 }).toBuffer();
  if (jpeg.byteLength >= MAX_PROVIDER_IMAGE_BYTES) {
    throw new ProviderError(
      "fatal",
      "image_too_large_for_provider",
      `Converted image is ${jpeg.byteLength} bytes, at or above the provider limit of ${MAX_PROVIDER_IMAGE_BYTES}.`,
    );
  }
  return { bytes: new Uint8Array(jpeg), mime: "image/jpeg" };
}