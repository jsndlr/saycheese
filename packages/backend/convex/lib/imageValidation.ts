"use node";

import type { ErrorCode } from "@saycheese/core/errors";
import {
  MAX_PIXELS,
  dimensionViolation,
  exceedsByteCap,
  isAllowedImageMime,
  type ImageMime,
} from "@saycheese/core/limits";
import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata } from "sharp";

/**
 * Upload validation for the process action. This module imports sharp, so it
 * MUST only be imported from `"use node"` files; mutations and the edge tests
 * must never reach it.
 */

export type ValidatedImage = {
  ok: true;
  sniffedMime: ImageMime;
  width: number;
  height: number;
  pages: number;
  orientation?: number;
};

export type ImageValidationFailure = { ok: false; code: ErrorCode };

export type ImageValidation = ValidatedImage | ImageValidationFailure;

/**
 * Header reads run with `limitInputPixels: false` on purpose. With the cap
 * applied, sharp throws `Input image exceeds pixel limit` before the caller can
 * see the dimensions, which would turn every oversized image into
 * IMAGE_CORRUPT. Reading a header allocates no pixels, and the decoded check
 * below always runs with the cap, so nothing unbounded is ever decoded.
 */
const DECODE_LIMIT_PIXELS = MAX_PIXELS + 1;

function corrupt(): ImageValidationFailure {
  return { ok: false, code: "IMAGE_CORRUPT" };
}

/**
 * Validation order matters: cheap metadata first, pixels last.
 *
 * a. byte cap, because the client can lie about its own upload.
 * b. magic bytes, because the declared MIME comes from the client and the
 *    extension is meaningless.
 * c. header metadata, for dimensions before any pixel work.
 * d. core dimension rules.
 * e. animation.
 * f. a full decode check, so a truncated body fails here instead of inside
 *    task 2's re-encode.
 */
export async function validateImage(
  bytes: Uint8Array,
  declaredMime: string,
): Promise<ImageValidation> {
  if (exceedsByteCap(bytes.byteLength)) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE" };
  }

  let sniffedMime: string | undefined;
  try {
    sniffedMime = (await fileTypeFromBuffer(bytes))?.mime;
  } catch {
    // Undetectable bytes are indistinguishable from an unsupported format.
    return { ok: false, code: "UNSUPPORTED_MEDIA_TYPE" };
  }

  const declared = declaredMime.trim().toLowerCase();
  // TODO(task 4): decide whether HEIC joins the allowlist; file-type reports
  // `image/heic`, which is deliberately rejected until then.
  if (
    sniffedMime === undefined ||
    !isAllowedImageMime(sniffedMime) ||
    sniffedMime !== declared
  ) {
    return { ok: false, code: "UNSUPPORTED_MEDIA_TYPE" };
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      limitInputPixels: false,
      failOn: "error",
    }).metadata();
  } catch {
    return corrupt();
  }

  const { height, width } = metadata;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return corrupt();
  }

  const violation = dimensionViolation(width, height);
  if (violation !== null) {
    return { ok: false, code: violation };
  }

  const pages = metadata.pages ?? 1;
  if (pages > 1) {
    return { ok: false, code: "ANIMATED_UNSUPPORTED" };
  }

  // Everything above is header-only. Decode once now so a truncated JPEG is
  // rejected here rather than after the claim moved the row to `processing`.
  try {
    await sharp(bytes, {
      limitInputPixels: DECODE_LIMIT_PIXELS,
      failOn: "error",
    }).stats();
  } catch {
    return corrupt();
  }

  const result: ValidatedImage = {
    ok: true,
    sniffedMime,
    width,
    height,
    pages,
  };
  if (metadata.orientation !== undefined) {
    result.orientation = metadata.orientation;
  }
  return result;
}