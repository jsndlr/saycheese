import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  createVisionProvider,
  VISION_COST_MICROS_PER_IMAGE,
  VISION_MODEL,
} from "../convex/lib/providers/vision";

/**
 * Live Vision contract test. Skipped unless a service-account JSON is present,
 * which is intentional: this repository has none and CI does not set it.
 * Never run it against production credentials.
 */

const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

function serviceAccount(): ServiceAccount {
  if (!raw) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not set");
  return JSON.parse(raw) as ServiceAccount;
}

describe.skipIf(!raw)("Vision FACE_DETECTION contract", () => {
  it("returns a ProviderResult for a small generated WebP", async () => {
    const account = serviceAccount();
    const provider = createVisionProvider({
      clientEmail: account.client_email,
      privateKey: account.private_key,
      tokenUri: account.token_uri,
    });

    expect(provider.acceptedMimes).toContain("image/webp");
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

    const result = await provider.score({
      bytes: new Uint8Array(webp),
      mime: "image/webp",
      sha256: "0".repeat(64),
    });

    expect(provider.model).toBe(VISION_MODEL);
    expect(result.costMicros).toBe(VISION_COST_MICROS_PER_IMAGE);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // A blank image has no faces; the contract is that the call succeeds and
    // returns a well-formed (possibly empty) face list.
    expect(Array.isArray(result.faces)).toBe(true);
    expect(typeof result.joyLikelihood).toBe("string");
    for (const face of result.faces) {
      expect(face.faceConfidence).toBeGreaterThanOrEqual(0);
      expect(face.faceConfidence).toBeLessThanOrEqual(100);
      expect(face.area).toBeGreaterThanOrEqual(0);
      expect(face.sharpness).toBeUndefined();
    }
  }, 30_000);
});