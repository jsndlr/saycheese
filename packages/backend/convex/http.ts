import { httpRouter } from "convex/server";

import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { createAuth } from "./auth";
import { authComponent } from "./authComponent";
import { env } from "./env";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

const health = httpAction(async (ctx) => {
  const deploy = env.DEPLOYMENT_LABEL ?? null;

  try {
    await ctx.runQuery(api.healthCheck.get, {});
    return Response.json({ ok: true, db: true, deploy }, { status: 200 });
  } catch {
    return Response.json({ ok: false, db: false, deploy }, { status: 503 });
  }
});

http.route({
  path: "/health",
  method: "GET",
  handler: health,
});

export default http;
