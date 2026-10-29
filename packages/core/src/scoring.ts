export type ScoreStatus =
  | "scored"
  | "no_face"
  | "multiple_faces"
  | "low_quality"
  | "unavailable";

export type SmileScore = {
  score: number | null;
  confidence: number | null;
  faceCount: number;
  status: ScoreStatus;
  reason: string;
  provider: "rekognition" | "vision" | "stub";
  providerModel: string;
  configVersion: string;
  latencyMs: number;
  cached: boolean;
};

export const CONFIG_VERSION = "scoring-v1";
export const UNAVAILABLE_REASON = "Scoring is unavailable";
export const MIN_FACE_CONFIDENCE = 90;
export const MIN_SHARPNESS = 20;

const LOW_QUALITY_REASON = "Photo quality is too low to score";

export type ProviderFace = {
  area: number;
  smileConfidence: number;
  smileValue: boolean | null;
  faceConfidence: number;
  /** `undefined` when the provider has no sharpness signal (Vision). */
  sharpness?: number | null;
};

export type ProviderResult = {
  faces: readonly ProviderFace[];
  latencyMs: number;
  costMicros: number;
  error?: string;
  /** Vision only: joy likelihood of the dominant face; absent for other providers. */
  joyLikelihood?: string;
};

export function rekognitionSmileScore(smileConfidence: number, value: boolean): number {
  const raw = value ? smileConfidence : 100 - smileConfidence;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export const VISION_JOY_SCORES = {
  VERY_LIKELY: 90,
  LIKELY: 75,
  POSSIBLE: 50,
  UNLIKELY: 25,
  VERY_UNLIKELY: 10,
} as const;

const VISION_JOY_BY_LIKELIHOOD: Readonly<Record<string, number>> = VISION_JOY_SCORES;

export function visionJoyScore(likelihood: string): number | null {
  if (!Object.hasOwn(VISION_JOY_BY_LIKELIHOOD, likelihood)) return null;
  return VISION_JOY_BY_LIKELIHOOD[likelihood] ?? null;
}

export function pickDominantFace(faces: readonly ProviderFace[]): ProviderFace | null {
  let dominant: ProviderFace | null = null;
  for (const face of faces) {
    if (dominant === null || face.area > dominant.area) dominant = face;
  }
  return dominant;
}

type ProviderMeta =
  | {
      provider: "rekognition" | "stub";
      providerModel: string;
      cached: boolean;
    }
  | {
      provider: "vision";
      providerModel: string;
      cached: boolean;
      joyLikelihood: string;
    };

export function mapProviderResult(result: ProviderResult, meta: ProviderMeta): SmileScore {
  const dominant = pickDominantFace(result.faces);
  const base: Pick<
    SmileScore,
    | "confidence"
    | "faceCount"
    | "provider"
    | "providerModel"
    | "configVersion"
    | "latencyMs"
    | "cached"
  > = {
    confidence: dominant === null ? null : dominant.faceConfidence / 100,
    faceCount: result.faces.length,
    provider: meta.provider,
    providerModel: meta.providerModel,
    configVersion: CONFIG_VERSION,
    latencyMs: result.latencyMs,
    cached: meta.cached,
  };

  if (result.error !== undefined) {
    return {
      ...base,
      score: null,
      status: "unavailable",
      reason: UNAVAILABLE_REASON,
    };
  }

  if (dominant === null) {
    return {
      ...base,
      score: null,
      confidence: null,
      faceCount: 0,
      status: "no_face",
      reason: "No face detected",
    };
  }

  if (
    dominant.faceConfidence < MIN_FACE_CONFIDENCE ||
    (dominant.sharpness != null && dominant.sharpness < MIN_SHARPNESS)
  ) {
    return {
      ...base,
      score: null,
      status: "low_quality",
      reason: LOW_QUALITY_REASON,
    };
  }

  let score: number;
  if (meta.provider === "vision") {
    const joyScore = visionJoyScore(meta.joyLikelihood);
    if (joyScore === null) {
      return {
        ...base,
        score: null,
        status: "low_quality",
        reason: LOW_QUALITY_REASON,
      };
    }
    score = joyScore;
  } else {
    if (dominant.smileValue === null) {
      return {
        ...base,
        score: null,
        status: "low_quality",
        reason: LOW_QUALITY_REASON,
      };
    }
    score = rekognitionSmileScore(dominant.smileConfidence, dominant.smileValue);
  }

  const multiple = result.faces.length > 1;
  return {
    ...base,
    score,
    status: multiple ? "multiple_faces" : "scored",
    reason: multiple ? `Scored the largest of ${result.faces.length} faces` : "Scored",
  };
}