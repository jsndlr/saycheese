import { authedQuery } from "./functions";

export const get = authedQuery({
  args: {},
  permission: { resource: "image", action: "read" },
  handler: async () => {
    return {
      message: "This is private",
    };
  },
});
