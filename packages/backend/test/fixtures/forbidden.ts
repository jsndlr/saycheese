/**
 * Test-only Convex function. It lives outside `convex/` on purpose: it exists
 * to exercise the FORBIDDEN branch of the wrapper and must never ship.
 *
 * `test/runtime.test.ts` maps it into convex-test as the module `testOnly`, so
 * it is not part of the deployed function tree.
 */
import { authedQuery } from "../../convex/functions";

export const audit = authedQuery({
  args: {},
  permission: { resource: "audit", action: "read" },
  handler: async (ctx) => ctx.user.id,
});