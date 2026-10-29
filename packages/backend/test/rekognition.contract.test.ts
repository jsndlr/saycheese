import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { providerImage } from "../convex/lib/providerImage";
import {
  createRekognitionProvider,
  REKOGNITION_COST_MICROS_PER_IMAGE,
  REKOGNITION_MODEL,
} from "../convex/lib/providers/rekognition";

/**
 * Live Rekognition contract test. Skipped unless AWS credentials are present,
 * which is intentional: this repository has none and CI does not set them.
 * Never run it against production credentials.
 */

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const region = process.env.AWS_REGION ?? "us-east-1";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

describe.skipIf(!accessKeyId)("Rekognition DetectFaces contract", () => {
  it("returns a ProviderResult for a small generated WebP", async () => {
    if (!accessKeyId) {
      throw new Error("AWS_ACCESS_KEY_ID is not set");
    }
    if (!secretAccessKey) {
      throw new Error("AWS_ACCESS_KEY_ID is set but AWS_SECRET_ACCESS_KEY is not");
    }

    const provider = createRekognitionProvider({
      region,
      accessKeyId,
      secretAccessKey,
    });

    // The production path stores WebP and lets scoring convert it; sending the
    // WebP directly here is what previously masked InvalidImageFormatException.
    const webp = await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 3,
        background: { r: 200, g: 180, b: 160 },
      },
    })
      .webp()
      .toBuffer();

    expect(provider.acceptedMimes).not.toContain("image/webp");
    const image = await providerImage(
      new Uint8Array(webp),
      "image/webp",
      provider.acceptedMimes,
    );
    expect(await fileTypeFromBuffer(image.bytes)).toMatchObject({ mime: "image/jpeg" });

    const result = await provider.score({
      bytes: image.bytes,
      mime: image.mime,
      sha256: "0".repeat(64),
    });

    expect(provider.model).toBe(REKOGNITION_MODEL);
    expect(result.costMicros).toBe(REKOGNITION_COST_MICROS_PER_IMAGE);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // A blank image has no faces; the contract is that the call succeeds and
    // returns a well-formed (possibly empty) face list.
    expect(Array.isArray(result.faces)).toBe(true);
    for (const face of result.faces) {
      expect(face.faceConfidence).toBeGreaterThanOrEqual(0);
      expect(face.faceConfidence).toBeLessThanOrEqual(100);
      expect(face.area).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);
});