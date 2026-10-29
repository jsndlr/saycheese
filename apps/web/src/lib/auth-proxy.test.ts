import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { forwardAuthRequest, rewriteAuthRequest, resolveClientIp } from "./auth-proxy";

const SECRET = "proxy-secret-proxy-secret-proxy-32";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost:3001/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email: "a@b.test" }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveClientIp", () => {
  it("off Vercel trusts no forwarded address", () => {
    vi.stubEnv("VERCEL", "");
    const headers = new Headers({
      "x-real-ip": "198.51.100.4",
      "x-forwarded-for": "1.1.1.1, 198.51.100.5",
      "x-vercel-forwarded-for": "198.51.100.6",
    });
    expect(resolveClientIp(headers)).toBeNull();
  });

  it("on Vercel prefers x-vercel-forwarded-for (first entry)", () => {
    vi.stubEnv("VERCEL", "1");
    expect(
      resolveClientIp(
        new Headers({
          "x-vercel-forwarded-for": "198.51.100.6, 10.0.0.1",
          "x-forwarded-for": "1.1.1.1, 198.51.100.5",
        }),
      ),
    ).toBe("198.51.100.6");
  });

  it("on Vercel falls back to the Vercel-overwritten x-forwarded-for", () => {
    vi.stubEnv("VERCEL", "1");
    expect(resolveClientIp(new Headers({ "x-forwarded-for": "198.51.100.7" }))).toBe(
      "198.51.100.7",
    );
  });

  it("on Vercel without a forwarded address, sends nothing", () => {
    vi.stubEnv("VERCEL", "1");
    expect(resolveClientIp(new Headers())).toBeNull();
  });
});

describe("rewriteAuthRequest", () => {
  it("off Vercel strips spoofed proxy and forwarded headers", async () => {
    vi.stubEnv("VERCEL", "");
    const rewritten = await rewriteAuthRequest(
      request({
        "x-saycheese-client-ip": "6.6.6.6",
        "x-saycheese-proxy-secret": "attacker",
        "x-real-ip": "198.51.100.6",
        "x-forwarded-for": "198.51.100.6",
      }),
      SECRET,
    );

    expect(rewritten.headers.get("x-saycheese-client-ip")).toBeNull();
    expect(rewritten.headers.get("x-saycheese-proxy-secret")).toBe(SECRET);
    expect(rewritten.method).toBe("POST");
    expect(await rewritten.json()).toEqual({ email: "a@b.test" });
  });

  it("on Vercel sets the platform address and the secret", async () => {
    vi.stubEnv("VERCEL", "1");
    const rewritten = await rewriteAuthRequest(
      request({
        "x-saycheese-client-ip": "6.6.6.6",
        "x-saycheese-proxy-secret": "attacker",
        "x-vercel-forwarded-for": "198.51.100.8",
        "x-forwarded-for": "6.6.6.6",
      }),
      SECRET,
    );

    expect(rewritten.headers.get("x-saycheese-client-ip")).toBe("198.51.100.8");
    expect(rewritten.headers.get("x-saycheese-proxy-secret")).toBe(SECRET);
  });

  it("omits the secret header when none is configured", async () => {
    vi.stubEnv("VERCEL", "1");
    const rewritten = await rewriteAuthRequest(
      request({ "x-saycheese-proxy-secret": "attacker", "x-forwarded-for": "1.2.3.4" }),
      undefined,
    );
    expect(rewritten.headers.get("x-saycheese-proxy-secret")).toBeNull();
    expect(rewritten.headers.get("x-saycheese-client-ip")).toBe("1.2.3.4");
  });
});

describe("forwardAuthRequest with a real NextRequest", () => {
  it("forwards a plain Request, never the NextRequest instance", async () => {
    vi.stubEnv("VERCEL", "");
    const incoming = new NextRequest("http://localhost:3001/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-saycheese-client-ip": "6.6.6.6",
        "x-saycheese-proxy-secret": "attacker",
      },
      body: JSON.stringify({ email: "next@b.test", password: "wrong-password" }),
    });

    let forwarded: Request | undefined;
    const response = await forwardAuthRequest(
      incoming,
      async (outgoing) => {
        forwarded = outgoing;
        return new Response(await outgoing.text(), { status: 200 });
      },
      SECRET,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      JSON.stringify({ email: "next@b.test", password: "wrong-password" }),
    );
    // Request's static Symbol.hasInstance is inherited by NextRequest, so `instanceof`
    // cannot tell them apart; the prototype can.
    expect(Object.getPrototypeOf(incoming)).toBe(NextRequest.prototype);
    expect(Object.getPrototypeOf(forwarded)).toBe(Request.prototype);
    expect(forwarded?.headers.get("x-saycheese-client-ip")).toBeNull();
    expect(forwarded?.headers.get("x-saycheese-proxy-secret")).toBe(SECRET);
    // The failure mode was reading these on a cross-realm object; touching the
    // plain request's state must not throw.
    expect(() => forwarded?.headers.get("content-type")).not.toThrow();
    expect(() => forwarded?.bodyUsed).not.toThrow();
  });

  it("forwards a bodyless GET", async () => {
    const incoming = new NextRequest("http://localhost:3001/api/auth/get-session", {
      method: "GET",
      headers: { cookie: "session=abc" },
    });
    let forwarded: Request | undefined;
    const response = await forwardAuthRequest(
      incoming,
      async (outgoing) => {
        forwarded = outgoing;
        return new Response("ok");
      },
      undefined,
    );
    expect(response.status).toBe(200);
    expect(forwarded?.method).toBe("GET");
    expect(forwarded?.body).toBeNull();
    expect(forwarded?.headers.get("cookie")).toBe("session=abc");
  });
});
