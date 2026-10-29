import { afterEach, describe, expect, it, vi } from "vitest";

import { rewriteAuthRequest, resolveClientIp } from "./auth-proxy";

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
    const rewritten = rewriteAuthRequest(
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

  it("on Vercel sets the platform address and the secret", () => {
    vi.stubEnv("VERCEL", "1");
    const rewritten = rewriteAuthRequest(
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

  it("omits the secret header when none is configured", () => {
    vi.stubEnv("VERCEL", "1");
    const rewritten = rewriteAuthRequest(
      request({ "x-saycheese-proxy-secret": "attacker", "x-forwarded-for": "1.2.3.4" }),
      undefined,
    );
    expect(rewritten.headers.get("x-saycheese-proxy-secret")).toBeNull();
    expect(rewritten.headers.get("x-saycheese-client-ip")).toBe("1.2.3.4");
  });
});
