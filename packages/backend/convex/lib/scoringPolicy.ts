/**
 * Plan 6.2 timing for a single image score.
 *
 * Isolated in its own module so tests can substitute small values and exercise
 * the timeout/retry paths without waiting six seconds. Production code reads
 * exactly these values.
 */

/** One provider call may run for this long before the AbortController fires. */
export const SCORING_CALL_TIMEOUT_MS = 6_000;

/** Wall-clock budget for all attempts of one image, including retry waits. */
export const SCORING_TOTAL_BUDGET_MS = 10_000;

/** Wait before the single retry (before jitter is applied). */
export const SCORING_RETRY_DELAY_MS = 200;

/** Jitter is `± SCORING_RETRY_JITTER_MS`, so the wait stays around 200 ms. */
export const SCORING_RETRY_JITTER_MS = 50;