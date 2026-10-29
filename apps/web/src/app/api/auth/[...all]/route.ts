import { ENV } from "@/env";
import { forwardAuthRequest } from "@/lib/auth-proxy";
import { handler } from "@/lib/auth-server";

// Every auth request crosses this proxy so Convex receives the authenticated
// `x-saycheese-client-ip` / `x-saycheese-proxy-secret` pair instead of trusting
// client headers (see `src/lib/auth-proxy.ts`).
export const GET = (request: Request) =>
  forwardAuthRequest(request, handler.GET, ENV.AUTH_PROXY_SECRET);

export const POST = (request: Request) =>
  forwardAuthRequest(request, handler.POST, ENV.AUTH_PROXY_SECRET);
