"use node";

import { MAX_PIXELS, VARIANTS, WEBP_QUALITY } from "@saycheese/core/limits";
import sharp from "sharp";

/**
 * Re-encodes a validated upload into the three stored variants.
 *
 * Every output is decoded from the auto-oriented pixel grid and written as a
 * fresh WebP, so the original EXIF block (including GPS), XMP and ICC profile
 * never reach storage and any trailing payload (a JPEG/PHP polyglot) is
 * dropped. Metadata is not requested on output: sharp 0.35 writes a bare WebP
 * unless `withMetadata`/`keepMetadata`/`withExif` is called.
 *
 * This module imports sharp, so it MUST only be imported from `"use node"`
 * files.
 */

export type EncodedVariant = {
  bytes: Buffer;
  width: number;
  height: number;
};

export type EncodedVariants = {
  /** Oriented source dimensions, before any resize. */
  width: number;
  height: number;
  variants: {
    original: EncodedVariant;
    preview: EncodedVariant;
    thumb: EncodedVariant;
  };
};

function coreEdge(name: "large" | "medium" | "thumb"): number {
  const variant = VARIANTS.find((candidate) => candidate.name === name);
  if (variant === undefined) {
    throw new Error(`Core limits have no "${name}" variant.`);
  }
  return variant.edge;
}

// Core names stay `large`/`medium`/`thumb`; the images table addresses the same
// three outputs as `original`/`preview`/`thumb`. Edge lengths come from core so
// they exist in exactly one place.
const EDGES = {
  original: coreEdge("large"),
  preview: coreEdge("medium"),
  thumb: coreEdge("thumb"),
} as const;

export async function encodeVariants(
  bytes: Buffer,
): Promise<EncodedVariants> {
  // One input pipeline, auto-oriented once. Each variant decodes from its own
  // clone of that same pipeline.
  const source = sharp(bytes, {
    limitInputPixels: MAX_PIXELS + 1,
    failOn: "error",
  }).rotate();

  const metadata = await source.metadata();
  const { width, height } = metadata;
  if (width === undefined || height === undefined) {
    throw new Error("Source image has no dimensions.");
  }
  const oriented = metadata.autoOrient ?? { width, height };

  const encode = async (edge: number): Promise<EncodedVariant> => {
    const { data, info } = await source
      .clone()
      .resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  };

  const [original, preview, thumb] = await Promise.all([
    encode(EDGES.original),
    encode(EDGES.preview),
    encode(EDGES.thumb),
  ]);

  return {
    width: oriented.width,
    height: oriented.height,
    variants: { original, preview, thumb },
  };
}