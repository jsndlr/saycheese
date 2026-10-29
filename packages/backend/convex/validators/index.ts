import { ERROR_CODES } from "@saycheese/core/errors";
import { v } from "convex/values";

/**
 * Shared validators. Every table validator in `schema.ts` comes from here so
 * commands, queries and tests all agree on the accepted literals.
 */

export const imageStatus = v.union(
  v.literal("uploaded"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("scoring"),
  v.literal("scored"),
  v.literal("failed"),
);

// Mirrors `ScoreStatus` in packages/core/src/scoring.ts. Core does not have a
// `pending` member, so neither does this validator (a score row only exists
// once a provider has answered).
export const scoreStatus = v.union(
  v.literal("scored"),
  v.literal("no_face"),
  v.literal("multiple_faces"),
  v.literal("low_quality"),
  v.literal("unavailable"),
);

export const provider = v.union(
  v.literal("rekognition"),
  v.literal("vision"),
  v.literal("stub"),
);

/**
 * Built from the core `ERROR_CODES` tuple instead of a hand-written list, so a
 * new code in core is automatically accepted here. `Infer` of this validator
 * is exactly the core `ErrorCode` union.
 */
export const errorCode = v.union(...ERROR_CODES.map((code) => v.literal(code)));

export const auditAction = v.union(
  v.literal("image.commit"),
  v.literal("image.archive"),
  v.literal("image.rescore"),
  v.literal("image.fail"),
  v.literal("score.record"),
  v.literal("score.fail"),
  v.literal("auth.signin"),
);

export const scoringOutcome = v.union(
  v.literal("success"),
  v.literal("retryable_error"),
  v.literal("fatal_error"),
  v.literal("timeout"),
);

/** JSON object with arbitrary (but string-keyed) payloads. */
export const jsonRecord = v.record(v.string(), v.any());