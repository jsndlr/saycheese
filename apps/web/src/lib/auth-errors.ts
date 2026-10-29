import { ERROR_MESSAGES, type ErrorCode } from "@saycheese/core/errors";

/**
 * Better Auth error codes → core error codes. Codes verified against
 * @better-auth/core 1.6.17 `BASE_ERROR_CODES`; anything unmapped is INTERNAL.
 */
const AUTH_ERROR_CODES: Readonly<Record<string, ErrorCode>> = {
  USER_ALREADY_EXISTS: "EMAIL_TAKEN",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "EMAIL_TAKEN",
  INVALID_EMAIL_OR_PASSWORD: "INVALID_CREDENTIALS",
  INVALID_EMAIL: "INVALID_CREDENTIALS",
  INVALID_PASSWORD: "INVALID_CREDENTIALS",
  PASSWORD_TOO_SHORT: "VALIDATION_FAILED",
  PASSWORD_TOO_LONG: "VALIDATION_FAILED",
  // Convex-side sign-in limiter (convex/auth.ts) answers 429 with this code.
  TOO_MANY_REQUESTS: "RATE_LIMITED",
};

export function mapAuthErrorCode(code: string | null | undefined): ErrorCode {
  if (typeof code !== "string") {
    return "INTERNAL";
  }
  return AUTH_ERROR_CODES[code] ?? "INTERNAL";
}

export function authErrorMessage(code: string | null | undefined): string {
  return ERROR_MESSAGES[mapAuthErrorCode(code)];
}