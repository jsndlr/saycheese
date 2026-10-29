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
// A `scoring` row older than `SCORING_TIMEOUT_MS` instead gets an `unavailable`
// score: its image is fine, only the score is missing.
crons.interval(
  "sweep stuck images",
  { minutes: 10 },
  internal.internal.stuckImages.run,
  {},
);

// Archived rows keep their storage objects for `ARCHIVE_RETENTION_MS` so a
// mistaken archive stays recoverable. The sweep then deletes those objects and
// keeps the row, which preserves audit history.
crons.interval(
  "purge archived images",
  { hours: 24 },
  internal.internal.archiveSweep.run,
  {},
);

export default crons;