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

export default crons;