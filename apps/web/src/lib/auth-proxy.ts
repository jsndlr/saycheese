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

/**
 * Rebuilds the request from plain values only.
 *
 * Passing a `NextRequest` (or its headers/body stream) into `new Request(...)`
 * makes the new object share Next's request internals across realms; Next's
 * `Request` subclass then reads private fields the platform `Request` never
 * initialised and the route throws `Cannot read private member #state`.
 * String headers and an `ArrayBuffer` body are implementation-free, so the
 * object handed to the library handler is a plain `Request`.
 */
export async function rewriteAuthRequest(
  incoming: Request,
  secret: string | undefined,
): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of incoming.headers) {
    const lower = name.toLowerCase();
    if (lower === CLIENT_IP_HEADER || lower === PROXY_SECRET_HEADER) {
      continue;
    }
    headers.append(name, value);
  }
  const clientIp = resolveClientIp(headers);
  if (clientIp !== null) {
    headers.set(CLIENT_IP_HEADER, clientIp);
  }
  if (secret !== undefined && secret.length > 0) {
    headers.set(PROXY_SECRET_HEADER, secret);
  }

  const method = incoming.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" ? undefined : await incoming.arrayBuffer();
  return new Request(incoming.url, {
    method,
    headers,
    body,
    redirect: "manual",
  });
}

export async function forwardAuthRequest(
  request: Request,
  forward: (request: Request) => Promise<Response>,
  secret: string | undefined,
): Promise<Response> {
  return await forward(await rewriteAuthRequest(request, secret));
}
