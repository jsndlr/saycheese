import { env } from "../env";
import { authedQuery } from "../functions";

/**
 * The caller's own profile. No resource permission is involved: any signed-in
 * user may read their own identity.
 */
export const current = authedQuery({
  args: {},
  permission: "signed-in",
  handler: async (ctx) => ({
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
    },
    release: env.SCORING_CONFIG_VERSION,
  }),
});
