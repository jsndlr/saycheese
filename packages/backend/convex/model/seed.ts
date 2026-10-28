import type { ScoreStatus } from "@saycheese/core/scoring";

/**
 * Pure description of the demo data set. Kept free of Convex and Node imports
 * so both the Node seed action and the edge test suite can build the same
 * five images.
 */

export type SeedScore = {
  score: number | null;
  confidence: number | null;
  faceCount: number;
  status: ScoreStatus;
  reason: string;
  latencyMs: number;
};

export type SeedImage = {
  /** Stable label, also used in test failure messages. */
  key: string;
  status: "scored" | "scoring" | "failed";
  failureCode?: "IMAGE_CORRUPT";
  /**
   * True when the processed WebP variants exist. A `scoring` image has been
   * processed but has no score yet; a failed image stores no objects at all.
   */
  hasVariants: boolean;
  palette: {
    from: readonly [number, number, number];
    to: readonly [number, number, number];
  };
  score?: SeedScore;
};

export const SEED_SOURCE = { width: 1200, height: 900 } as const;

/** True when a row still points at any storage object. */
export function hasStorageRefs(image: {
  rawStorageId?: unknown;
  storageId?: unknown;
  previewId?: unknown;
  thumbId?: unknown;
}): boolean {
  return (
    image.rawStorageId !== undefined ||
    image.storageId !== undefined ||
    image.previewId !== undefined ||
    image.thumbId !== undefined
  );
}

/** The fields that identify which demo state a row is in. */
export type SeedState = {
  status: string;
  failureCode?: string | null;
  /** True when the row still points at any storage object. */
  hasStorage?: boolean;
};

/**
 * True when an existing row already represents the spec. A `failed` spec also
 * pins the failure code and requires no storage references (a failure always
 * cleans up its objects), so a timed-out row or an old row with a leftover raw
 * object is not mistaken for the intended state.
 */
export function matchesSeedState(
  expected: SeedState,
  actual: SeedState,
): boolean {
  if (expected.status !== actual.status) {
    return false;
  }
  if (expected.failureCode !== undefined) {
    if (actual.failureCode !== expected.failureCode) {
      return false;
    }
  } else if (actual.failureCode !== undefined && actual.failureCode !== null) {
    return false;
  }
  return expected.status !== "failed" || actual.hasStorage !== true;
}

/**
 * Rows the seed may replace: an upload whose process job never ran, a row the
 * stuck sweep failed for timing out, and an old failed seed row that still
 * references storage (the current spec stores nothing for a failure). Any
 * other existing row (a user's real image) is left alone.
 */
export function isRepairableSeedState(actual: SeedState): boolean {
  return (
    actual.status === "uploaded" ||
    (actual.status === "failed" &&
      (actual.failureCode === "IMAGE_TIMEOUT" ||
        (actual.failureCode === "IMAGE_CORRUPT" && actual.hasStorage === true)))
  );
}

export const SEED_IMAGES: readonly SeedImage[] = [
  {
    key: "scored-82",
    status: "scored",
    hasVariants: true,
    palette: { from: [255, 196, 120], to: [255, 96, 112] },
    score: {
      score: 82,
      confidence: 0.99,
      faceCount: 1,
      status: "scored",
      reason: "Scored",
      latencyMs: 214,
    },
  },
  {
    key: "no-face",
    status: "scored",
    hasVariants: true,
    palette: { from: [120, 168, 255], to: [88, 96, 190] },
    score: {
      score: null,
      confidence: null,
      faceCount: 0,
      status: "no_face",
      reason: "No face detected",
      latencyMs: 188,
    },
  },
  {
    key: "multiple-faces",
    status: "scored",
    hasVariants: true,
    palette: { from: [132, 224, 160], to: [44, 140, 132] },
    score: {
      score: 68,
      confidence: 0.97,
      faceCount: 3,
      status: "multiple_faces",
      reason: "Scored the largest of 3 faces",
      latencyMs: 402,
    },
  },
  {
    key: "scoring",
    status: "scoring",
    hasVariants: true,
    palette: { from: [232, 232, 236], to: [168, 172, 184] },
  },
  {
    key: "failed",
    status: "failed",
    failureCode: "IMAGE_CORRUPT",
    hasVariants: false,
    palette: { from: [96, 96, 104], to: [32, 32, 40] },
  },
];