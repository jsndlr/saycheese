import { ERROR_MESSAGES } from "@saycheese/core/errors";
import { describe, expect, it } from "vitest";

import { authErrorMessage, mapAuthErrorCode } from "./auth-errors";

describe("T-AUTH-03 mapAuthErrorCode: account already exists", () => {
  it("maps the Better Auth duplicate-user codes to EMAIL_TAKEN", () => {
    expect(mapAuthErrorCode("USER_ALREADY_EXISTS")).toBe("EMAIL_TAKEN");
    expect(mapAuthErrorCode("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")).toBe("EMAIL_TAKEN");
  });
});

describe("T-AUTH-04 mapAuthErrorCode: invalid credentials", () => {
  it("maps bad email/password codes to INVALID_CREDENTIALS", () => {
    for (const code of ["INVALID_EMAIL_OR_PASSWORD", "INVALID_EMAIL", "INVALID_PASSWORD"]) {
      expect(mapAuthErrorCode(code)).toBe("INVALID_CREDENTIALS");
    }
  });
});

describe("mapAuthErrorCode: password policy", () => {
  it("maps length failures to VALIDATION_FAILED", () => {
    expect(mapAuthErrorCode("PASSWORD_TOO_SHORT")).toBe("VALIDATION_FAILED");
    expect(mapAuthErrorCode("PASSWORD_TOO_LONG")).toBe("VALIDATION_FAILED");
  });
});

describe("mapAuthErrorCode: unknown input", () => {
  it("falls back to INTERNAL for unmapped, empty and missing codes", () => {
    for (const code of ["SOMETHING_NEW", "user_already_exists", "", undefined, null]) {
      expect(mapAuthErrorCode(code)).toBe("INTERNAL");
    }
  });
});

describe("authErrorMessage", () => {
  it("returns the core copy for a mapped code", () => {
    expect(authErrorMessage("USER_ALREADY_EXISTS")).toBe(ERROR_MESSAGES.EMAIL_TAKEN);
    expect(authErrorMessage("INVALID_EMAIL_OR_PASSWORD")).toBe(
      ERROR_MESSAGES.INVALID_CREDENTIALS,
    );
  });

  it("returns the generic core copy for an unknown code", () => {
    expect(authErrorMessage("NOPE")).toBe(ERROR_MESSAGES.INTERNAL);
  });
});
describe("T-SEC-05 mapAuthErrorCode: sign-in rate limit", () => {
  it("maps the Convex limiter's 429 code to RATE_LIMITED copy", () => {
    expect(mapAuthErrorCode("TOO_MANY_REQUESTS")).toBe("RATE_LIMITED");
    expect(authErrorMessage("TOO_MANY_REQUESTS")).toBe(ERROR_MESSAGES.RATE_LIMITED);
  });
});
