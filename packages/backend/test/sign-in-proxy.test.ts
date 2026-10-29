import { expect, it } from "vitest";

import { signInIpKey } from "../convex/auth";

const SECRET = "proxy-secret-proxy-secret-proxy-32";
const IP_HEADER = "x-saycheese-client-ip";
const SECRET_HEADER = "x-saycheese-proxy-secret";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

it("uses the proxy-provided IP only when the shared secret matches", () => {
  expect(
    signInIpKey(
      headers({ [IP_HEADER]: "203.0.113.9", [SECRET_HEADER]: SECRET }),
      SECRET,
    ),
  ).toBe("203.0.113.9");
  expect(
    signInIpKey(
      headers({ [IP_HEADER]: " 203.0.113.9 ", [SECRET_HEADER]: SECRET }),
      SECRET,
    ),
  ).toBe("203.0.113.9");
});

it("falls back to the shared direct bucket for a wrong or missing secret", () => {
  expect(
    signInIpKey(
      headers({ [IP_HEADER]: "203.0.113.9", [SECRET_HEADER]: "wrong-secret-wrong-secret-wrong-32" }),
      SECRET,
    ),
  ).toBe("direct");
  expect(signInIpKey(headers({ [IP_HEADER]: "203.0.113.9" }), SECRET)).toBe("direct");
  // A direct caller cannot spoof the header when no secret is configured.
  expect(
    signInIpKey(
      headers({ [IP_HEADER]: "203.0.113.9", [SECRET_HEADER]: SECRET }),
      undefined,
    ),
  ).toBe("direct");
});

it("falls back to direct when the secret matches but no IP is present", () => {
  expect(signInIpKey(headers({ [SECRET_HEADER]: SECRET }), SECRET)).toBe("direct");
  expect(
    signInIpKey(headers({ [IP_HEADER]: "   ", [SECRET_HEADER]: SECRET }), SECRET),
  ).toBe("direct");
});
