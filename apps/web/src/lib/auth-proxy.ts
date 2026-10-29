/**
 * Authenticated proxy boundary for the Better Auth route.
 *
 * The Convex HTTP router is publicly reachable, so it cannot trust an IP header
 * a client sent. This route is the only intended entry: it removes any
 * `x-saycheese-*` headers the client supplied, then sets the platform client
 * address and the shared secret itself. Convex trusts the address only when the
 * secret matches (`convex/auth.ts: signInIpKey`).
 */
export const CLIENT_IP_HEADER = "x-saycheese-client-ip";
export const PROXY_SECRET_HEADER = "x-saycheese-proxy-secret";

function firstHop(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first !== undefined && first.length > 0 ? first : null;
}

/**
 * Client address to vouch for, or `null` when the platform is not trusted.
 *
 * Only Vercel overwrites `x-forwarded-for` (and does not forward external
 * IPs); elsewhere those headers come straight from the client, so forwarding
 * one with the proxy secret would vouch for a spoof. On Vercel,
 * `x-vercel-forwarded-for` is the value a proxy in front of Vercel cannot
 * overwrite, so it wins; Vercel-overwritten `x-forwarded-for` is the fallback
 * (first entry). Everywhere else no IP header is sent and Convex keys the
 * request as `direct`.
 *
 * https://vercel.com/docs/headers/request-headers
 */
export function resolveClientIp(
  headers: Headers,
  onVercel = process.env.VERCEL === "1",
): string | null {
  if (!onVercel) {
    return null;
  }
  return (
    firstHop(headers.get("x-vercel-forwarded-for")) ??
    firstHop(headers.get("x-forwarded-for"))
  );
}

/** Returns a copy of the request with only proxy-authored `x-saycheese-*` headers. */
export function rewriteAuthRequest(request: Request, secret: string | undefined): Request {
  const headers = new Headers(request.headers);
  const clientIp = resolveClientIp(headers);
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SECRET_HEADER);
  if (clientIp !== null) {
    headers.set(CLIENT_IP_HEADER, clientIp);
  }
  if (secret !== undefined && secret.length > 0) {
    headers.set(PROXY_SECRET_HEADER, secret);
  }
  return new Request(request, { headers });
}

export async function forwardAuthRequest(
  request: Request,
  forward: (request: Request) => Promise<Response>,
  secret: string | undefined,
): Promise<Response> {
  return await forward(rewriteAuthRequest(request, secret));
}
