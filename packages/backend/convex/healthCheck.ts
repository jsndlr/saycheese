import { publicQuery } from "./functions";

export const get = publicQuery({
  args: {},
  access: "public",
  handler: async (ctx) => {
    // `_storage` is a built-in system table present in every deployment, so this
    // read works while the app schema is empty. `.first()` yields null when the
    // table is empty instead of throwing.
    await ctx.db.system.query("_storage").first();
    return "OK";
  },
});
