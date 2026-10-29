/**
 * Response headers for every route. Kept out of `next.config.ts` so the policy
 * can be unit tested without loading the Varlock config plugin.
 *
 * The CSP is production only. The dev server needs `eval` for HMR and a
 * websocket for the refresh overlay, and shipping a policy that blocks those
 * would teach everyone to ignore the console.
 */

export type ResponseHeader = { key: string; value: string };

const CONVEX_HTTP = "https://*.convex.cloud";
const CONVEX_WS = "wss://*.convex.cloud";

/**
 * Everything the app actually loads: its own bundles and CSS, Convex file URLs
 * and the Convex websocket, inline hydration and theme scripts. `unsafe-inline`
 * is unavoidable without per-request nonces, which this app does not need yet;
 * there is no `unsafe-eval` and no third-party script origin.
 */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `img-src 'self' data: blob: ${CONVEX_HTTP}`,
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${CONVEX_HTTP} ${CONVEX_WS}`,
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Headers that are safe in every environment. */
export function securityHeaders(production: boolean): ResponseHeader[] {
  const headers: ResponseHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
  ];
  if (production) {
    headers.push({
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(),
    });
  }
  return headers;
}
