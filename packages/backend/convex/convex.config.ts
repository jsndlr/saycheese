import betterAuth from "@convex-dev/better-auth/convex.config";
import workpool from "@convex-dev/workpool/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(betterAuth);
// Plan 6.2: at most four provider calls in flight. Retries happen inside the
// scoring action (so each attempt lands in `scoringAttempts` and shares one
// 10 s budget), so the component's own retry is disabled at enqueue time.
app.use(workpool, { name: "scoringPool" });

export default app;
