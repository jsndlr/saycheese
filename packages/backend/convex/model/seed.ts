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
  status: "scored" | "uploaded" | "failed";
  failureCode?: "IMAGE_CORRUPT";
  /** True when the processed WebP variants exist. Failed/pending keep the raw PNG. */
  hasVariants: boolean;
  palette: {
    from: readonly [number, number, number];
    to: readonly [number, number, number];
  };
  score?: SeedScore;
};

export const SEED_SOURCE = { width: 1200, height: 900 } as const;

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
    key: "pending",
    status: "uploaded",
    hasVariants: false,
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