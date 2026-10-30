import { describe, expect, it } from "vitest";

import {
  CONFIG_VERSION,
  MIN_FACE_CONFIDENCE,
  MIN_SHARPNESS,
  mapProviderResult,
  pickDominantFace,
  rekognitionSmileScore,
  visionJoyScore,
} from "./scoring";
import type { ProviderFace, ProviderResult } from "./scoring";

type Meta = Parameters<typeof mapProviderResult>[1];
type NonVisionMeta = Exclude<Meta, { provider: "vision" }>;
type VisionMeta = Extract<Meta, { provider: "vision" }>;

function face(overrides: Partial<ProviderFace> = {}): ProviderFace {
  return {
    area: 1000,
    smileConfidence: 87.4,
    smileValue: true,
    faceConfidence: 99,
    sharpness: 55,
    ...overrides,
  };
}

function providerResult(overrides: Partial<ProviderResult> = {}): ProviderResult {
  return {
    faces: [face()],
    latencyMs: 412,
    costMicros: 1000,
    ...overrides,
  };
}

function meta(overrides: Partial<NonVisionMeta> = {}): NonVisionMeta {
  return {
    provider: "rekognition",
    providerModel: "aws-rekognition-v1",
    cached: false,
    ...overrides,
  };
}

function visionMeta(joyLikelihood: string): VisionMeta {
  return {
    provider: "vision",
    providerModel: "google-vision-v1",
    cached: false,
    joyLikelihood,
  };
}

describe("rekognitionSmileScore", () => {
  it("scores a smiling face by confidence", () => {
    expect(rekognitionSmileScore(0, true)).toBe(0);
    expect(rekognitionSmileScore(50, true)).toBe(50);
    expect(rekognitionSmileScore(89.6, true)).toBe(90);
    expect(rekognitionSmileScore(100, true)).toBe(100);
  });

  it("inverts a non-smiling face", () => {
    expect(rekognitionSmileScore(0, false)).toBe(100);
    expect(rekognitionSmileScore(50, false)).toBe(50);
    expect(rekognitionSmileScore(89.6, false)).toBe(10);
    expect(rekognitionSmileScore(100, false)).toBe(0);
  });

  it("clamps to 0..100", () => {
    expect(rekognitionSmileScore(140, true)).toBe(100);
    expect(rekognitionSmileScore(-10, true)).toBe(0);
    expect(rekognitionSmileScore(-20, false)).toBe(100);
    expect(rekognitionSmileScore(120, false)).toBe(0);
  });
});

describe("visionJoyScore", () => {
  it("maps every known joy likelihood", () => {
    const expected: ReadonlyArray<readonly [string, number]> = [
      ["VERY_LIKELY", 90],
      ["LIKELY", 75],
      ["POSSIBLE", 50],
      ["UNLIKELY", 25],
      ["VERY_UNLIKELY", 10],
    ];

    for (const [likelihood, score] of expected) {
      expect(visionJoyScore(likelihood)).toBe(score);
    }
  });

  it("returns null for UNKNOWN and unrecognised likelihoods", () => {
    for (const likelihood of ["UNKNOWN", "", "very_likely", "LIKELY ", "MAYBE"]) {
      expect(visionJoyScore(likelihood)).toBeNull();
    }
  });

  it("returns null for inherited Object.prototype keys", () => {
    for (const likelihood of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(visionJoyScore(likelihood)).toBeNull();
    }
  });
});

describe("pickDominantFace", () => {
  it("returns null for no faces", () => {
    expect(pickDominantFace([])).toBeNull();
  });

  it("returns the only face", () => {
    const only = face();

    expect(pickDominantFace([only])).toBe(only);
  });

  it("returns the largest face", () => {
    const small = face({ area: 100 });
    const large = face({ area: 900 });

    expect(pickDominantFace([small, large])).toBe(large);
    expect(pickDominantFace([large, small])).toBe(large);
  });

  it("keeps the first face on an area tie", () => {
    const first = face({ area: 500, smileConfidence: 10 });
    const second = face({ area: 500, smileConfidence: 90 });

    expect(pickDominantFace([first, second])).toBe(first);
  });
});

describe("mapProviderResult", () => {
  it("reports no_face when the provider returns no faces", () => {
    const score = mapProviderResult(providerResult({ faces: [] }), meta());

    expect(score.status).toBe("no_face");
    expect(score.faceCount).toBe(0);
    expect(score.score).toBeNull();
    expect(score.confidence).toBeNull();
    expect(score.reason).toBe("No face detected");
    expect(score.configVersion).toBe(CONFIG_VERSION);
  });

  it("reports unavailable when the provider errors", () => {
    const score = mapProviderResult(providerResult({ error: "ThrottledException" }), meta());

    expect(score.status).toBe("unavailable");
    expect(score.score).toBeNull();
    expect(score.reason).toBe("Scoring is unavailable");
  });

  it("prefers unavailable over no_face when both apply", () => {
    const score = mapProviderResult(providerResult({ faces: [], error: "timeout" }), meta());

    expect(score.status).toBe("unavailable");
    expect(score.reason).toBe("Scoring is unavailable");
  });

  it("scores a single high-quality face", () => {
    const score = mapProviderResult(providerResult(), meta());

    expect(score.status).toBe("scored");
    expect(score.reason).toBe("Scored");
    expect(score.score).toBe(rekognitionSmileScore(87.4, true));
    expect(score.confidence).toBeCloseTo(0.99);
    expect(score.faceCount).toBe(1);
  });

  it("scores from the provider boolean, not the confidence threshold", () => {
    const score = mapProviderResult(
      providerResult({ faces: [face({ smileConfidence: 20, smileValue: true })] }),
      meta(),
    );

    expect(score.status).toBe("scored");
    expect(score.score).toBe(20);
  });

  it("scores a confidently non-smiling face as 1", () => {
    const score = mapProviderResult(
      providerResult({ faces: [face({ smileConfidence: 99, smileValue: false })] }),
      meta(),
    );

    expect(score.status).toBe("scored");
    expect(score.score).toBe(1);
    expect(score.confidence).toBeCloseTo(0.99);
  });

  it("scores a confidently smiling face as 99", () => {
    const score = mapProviderResult(
      providerResult({ faces: [face({ smileConfidence: 99, smileValue: true })] }),
      meta(),
    );

    expect(score.status).toBe("scored");
    expect(score.score).toBe(99);
  });

  it("rejects a non-vision result without a smile boolean as low quality", () => {
    const score = mapProviderResult(providerResult({ faces: [face({ smileValue: null })] }), meta());

    expect(score.status).toBe("low_quality");
    expect(score.score).toBeNull();
    expect(score.reason).toBe("Photo quality is too low to score");
  });

  it("rejects face confidence one point under the minimum", () => {
    const score = mapProviderResult(
      providerResult({ faces: [face({ faceConfidence: MIN_FACE_CONFIDENCE - 1 })] }),
      meta(),
    );

    expect(score.status).toBe("low_quality");
    expect(score.score).toBeNull();
    expect(score.reason).toBe("Photo quality is too low to score");
  });

  it("accepts face confidence at the minimum", () => {
    const score = mapProviderResult(
      providerResult({ faces: [face({ faceConfidence: MIN_FACE_CONFIDENCE })] }),
      meta(),
    );

    expect(score.status).toBe("scored");
  });

  it("rejects sharpness one point under the minimum", () => {
    const score = mapProviderResult(
      providerResult({ faces: [face({ sharpness: MIN_SHARPNESS - 1 })] }),
      meta(),
    );

    expect(score.status).toBe("low_quality");
    expect(score.score).toBeNull();
  });

  it("accepts sharpness at the minimum", () => {
    const score = mapProviderResult(
      providerResult({ faces: [face({ sharpness: MIN_SHARPNESS })] }),
      meta(),
    );

    expect(score.status).toBe("scored");
  });

  it("skips the sharpness check when the provider reports null", () => {
    const score = mapProviderResult(providerResult({ faces: [face({ sharpness: null })] }), meta());

    expect(score.status).toBe("scored");
    expect(score.score).not.toBeNull();
  });

  it("scores the largest face and says so when several were found", () => {
    const small = face({ area: 100, smileConfidence: 10, faceConfidence: 99 });
    const large = face({ area: 900, smileConfidence: 91, faceConfidence: 96 });
    const score = mapProviderResult(providerResult({ faces: [small, large] }), meta());

    expect(score.status).toBe("multiple_faces");
    expect(score.faceCount).toBe(2);
    expect(score.reason).toBe("Scored the largest of 2 faces");
    expect(score.score).toBe(91);
    expect(score.confidence).toBeCloseTo(0.96);
  });

  it("checks quality on the dominant face only", () => {
    const blurrySmall = face({ area: 100, faceConfidence: 10 });
    const clearLarge = face({ area: 900, faceConfidence: 99 });
    const score = mapProviderResult(providerResult({ faces: [blurrySmall, clearLarge] }), meta());

    expect(score.status).toBe("multiple_faces");
    expect(score.score).not.toBeNull();
  });

  it("maps a vision joy likelihood to a score", () => {
    const score = mapProviderResult(
      providerResult({ faces: [face({ smileValue: null })] }),
      visionMeta("VERY_LIKELY"),
    );

    expect(score.status).toBe("scored");
    expect(score.score).toBe(90);
    expect(score.provider).toBe("vision");
  });

  it("rejects a vision UNKNOWN joy likelihood as low quality", () => {
    const score = mapProviderResult(providerResult(), visionMeta("UNKNOWN"));

    expect(score.status).toBe("low_quality");
    expect(score.score).toBeNull();
    expect(score.reason).toBe("Photo quality is too low to score");
  });

  it("rejects an unrecognised vision joy likelihood as low quality", () => {
    const score = mapProviderResult(providerResult(), visionMeta("MAYBE"));

    expect(score.status).toBe("low_quality");
    expect(score.score).toBeNull();
  });

  it("rejects an inherited prototype key as a vision joy likelihood", () => {
    const score = mapProviderResult(providerResult(), visionMeta("__proto__"));

    expect(score.status).toBe("low_quality");
    expect(score.score).toBeNull();
  });

  it("requires a joy likelihood for a vision result at compile time", () => {
    const withoutLikelihood: Omit<VisionMeta, "joyLikelihood"> = {
      provider: "vision",
      providerModel: "google-vision-v1",
      cached: false,
    };

    // @ts-expect-error vision meta requires joyLikelihood
    const score = mapProviderResult(providerResult(), withoutLikelihood);

    expect(score.status).toBe("low_quality");
    expect(score.score).toBeNull();
  });

  it("carries provenance, latency and cache state through", () => {
    const score = mapProviderResult(
      providerResult({ latencyMs: 823 }),
      meta({ cached: true, provider: "stub", providerModel: "stub-v2" }),
    );

    expect(score.cached).toBe(true);
    expect(score.latencyMs).toBe(823);
    expect(score.provider).toBe("stub");
    expect(score.providerModel).toBe("stub-v2");
    expect(score.configVersion).toBe(CONFIG_VERSION);
  });
});