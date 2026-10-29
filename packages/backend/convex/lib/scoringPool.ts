import { Workpool } from "@convex-dev/workpool";

import { components } from "../_generated/api";

/**
 * Plan 6.2: four provider calls in flight at most, across every image.
 *
 * Retries are owned by the scoring action, not the component: each attempt is
 * a row in `scoringAttempts`, one 10 s wall-clock budget covers all attempts,
 * and the workpool only decides *when* an image starts. Component retries are
 * therefore explicitly disabled (they would multiply attempts invisibly).
 */
export const scoringPool = new Workpool(components.scoringPool, {
  maxParallelism: 4,
  retryActionsByDefault: false,
});