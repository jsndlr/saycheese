import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, securityHeaders } from "./security-headers";

function map(headers: { key: string; value: string }[]) {
  return Object.fromEntries(headers.map((h) => [h.key, h.value]));
}

describe("contentSecurityPolicy", () => {
  it("locks the page down to its own origin and Convex", () => {
    const csp = contentSecurityPolicy();
    const directives = Object.fromEntries(
      csp.split("; ").map((part) => {
        const [name, ...values] = part.split(" ");
        return [name, values.join(" ")];
      }),
    );

    expect(directives["default-src"]).toBe("'self'");
    expect(directives["object-src"]).toBe("'none'");
    expect(directives["frame-ancestors"]).toBe("'none'");
    expect(directives["base-uri"]).toBe("'self'");
    expect(directives["form-action"]).toBe("'self'");
    expect(directives["connect-src"]).toContain("https://*.convex.cloud");
    expect(directives["connect-src"]).toContain("wss://*.convex.cloud");
    expect(directives["img-src"]).toContain("https://*.convex.cloud");
  });

  it("never allows eval", () => {
    expect(contentSecurityPolicy()).not.toContain("unsafe-eval");
  });

  it("does not allow third-party script origins", () => {
    const scriptSrc = contentSecurityPolicy()
      .split("; ")
      .find((part) => part.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline'");
  });
});

describe("securityHeaders", () => {
  it("always sends the static headers", () => {
    for (const production of [false, true]) {
      const headers = map(securityHeaders(production));
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["Permissions-Policy"]).toContain("camera=()");
      expect(headers["Strict-Transport-Security"]).toContain("max-age=");
    }
  });

  it("sends the CSP only in production", () => {
    expect(map(securityHeaders(false))["Content-Security-Policy"]).toBeUndefined();
    expect(map(securityHeaders(true))["Content-Security-Policy"]).toBe(
      contentSecurityPolicy(),
    );
  });
});
