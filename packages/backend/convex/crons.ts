import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Uploads that are never committed, and objects left behind by a rejected
// commit (a throwing mutation rolls back its own storage delete), would
// otherwise stay in `_storage` forever.
crons.interval(
  "sweep orphan storage",
  { hours: 1 },
  internal.internal.storageSweep.run,
  {},
);

// A failed action, a lost scheduler run or a crash leaves the row in
// `processing`/`uploaded` forever; the sweep fails it with IMAGE_TIMEOUT after
// `PROCESSING_TIMEOUT_MS` and releases the storage objects it still owns.
crons.interval(
  "sweep stuck images",
  { minutes: 10 },
  internal.internal.stuckImages.run,
  {},
);

export default crons;