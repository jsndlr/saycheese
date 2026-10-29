import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from "@saycheese/core/errors";
import { BetterFetchError } from "@better-fetch/fetch";
import { APIError } from "better-auth";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { formatRetryAfter, toUiError, type UiErrorAction } from "./errors";

const ACTIONS: Record<ErrorCode, UiErrorAction> = {
  AUTH_REQUIRED: "sign-in",
  FORBIDDEN: "none",
  INVALID_CREDENTIALS: "none",
  EMAIL_TAKEN: "none",
  VALIDATION_FAILED: "none",
  PAYLOAD_TOO_LARGE: "change-file",
  UNSUPPORTED_MEDIA_TYPE: "change-file",
  HEIC_UNSUPPORTED: "change-file",
  ANIMATED_UNSUPPORTED: "change-file",
  IMAGE_TOO_LARGE: "change-file",
  IMAGE_TOO_SMALL: "change-file",
  IMAGE_CORRUPT: "change-file",
  IMAGE_TIMEOUT: "retry",
  UPLOAD_EXPIRED: "retry",
  RATE_LIMITED: "wait",
  SCORING_QUOTA: "wait",
  SCORING_UNAVAILABLE: "retry",
  NOT_FOUND: "none",
  NETWORK: "retry",
  INTERNAL: "retry",
};

describe("T-ERR-01 every core code maps to core copy and an action", () => {
  it("uses ERROR_MESSAGES and the declared action table", () => {
    for (const code of ERROR_CODES) {
      const error = new ConvexError({ code, message: `raw server copy for ${code}` });
      const ui = toUiError(error);

      expect(ui.code).toBe(code);
      expect(ui.message).toBe(ERROR_MESSAGES[code]);
      expect(ui.message).not.toContain("raw server copy");
      expect(ui.action).toBe(ACTIONS[code]);
    }
  });

  it("only produces the five declared actions", () => {
    const actions = new Set<UiErrorAction>();
    for (const code of ERROR_CODES) {
      actions.add(toUiError(new ConvexError({ code, message: "x" })).action);
    }

    expect([...actions].sort()).toEqual([
      "change-file",
      "none",
      "retry",
      "sign-in",
      "wait",
    ]);
  });
});

describe("T-ERR-02 ConvexError payload object and stringified payload", () => {
  it("maps a payload object", () => {
    const ui = toUiError(
      new ConvexError({
        code: "IMAGE_TOO_SMALL",
        message: "server copy should not surface",
        detail: { width: 10 },
      }),
    );

    expect(ui.code).toBe("IMAGE_TOO_SMALL");
    expect(ui.message).toBe(ERROR_MESSAGES.IMAGE_TOO_SMALL);
    expect(ui.action).toBe("change-file");
  });

  it("maps a JSON-stringified payload", () => {
    const ui = toUiError(
      new ConvexError(
        JSON.stringify({
          code: "HEIC_UNSUPPORTED",
          message: "server copy should not surface",
        }),
      ),
    );

    expect(ui.code).toBe("HEIC_UNSUPPORTED");
    expect(ui.message).toBe(ERROR_MESSAGES.HEIC_UNSUPPORTED);
    expect(ui.action).toBe("change-file");
  });

  it("accepts the envelope after cross-realm or plain-object serialisation", () => {
    const ui = toUiError({
      name: "ConvexError",
      data: JSON.stringify({ code: "UPLOAD_EXPIRED", message: "expired" }),
    });

    expect(ui.code).toBe("UPLOAD_EXPIRED");
    expect(ui.message).toBe(ERROR_MESSAGES.UPLOAD_EXPIRED);
  });
});

describe("T-ERR-03 rate limit retry hint", () => {
  it("carries detail.retryAfterMs and formats it", () => {
    const ui = toUiError(
      new ConvexError({
        code: "RATE_LIMITED",
        message: "slow down",
        detail: { retryAfterMs: 180_000 },
      }),
    );

    expect(ui.code).toBe("RATE_LIMITED");
    expect(ui.message).toBe(ERROR_MESSAGES.RATE_LIMITED);
    expect(ui.action).toBe("wait");
    expect(ui.retryAfterMs).toBe(180_000);
    expect(formatRetryAfter(ui.retryAfterMs ?? 0)).toBe("Try again in 3 minutes");
  });

  it("formats short waits and ignores unusable hints", () => {
    expect(formatRetryAfter(3_000)).toBe("Try again in a few seconds");

    const ui = toUiError(
      new ConvexError({
        code: "SCORING_QUOTA",
        message: "quota",
        detail: { retryAfterMs: -1 },
      }),
    );
    expect(ui.retryAfterMs).toBeUndefined();
  });
});

describe("T-ERR-04 unknown errors stay opaque", () => {
  it("maps an unknown thrown object to INTERNAL", () => {
    const ui = toUiError({ unexpected: true });

    expect(ui).toEqual({
      code: "INTERNAL",
      message: ERROR_MESSAGES.INTERNAL,
      action: "retry",
    });
  });

  it("maps a plain Error without leaking its text", () => {
    const ui = toUiError(
      new Error("SELECT * FROM users; DATABASE_URL=postgres://secret password=hunter2"),
    );

    expect(ui.code).toBe("INTERNAL");
    expect(ui.message).toBe(ERROR_MESSAGES.INTERNAL);
    expect(ui.message).not.toContain("hunter2");
    expect(ui.message).not.toContain("DATABASE_URL");
  });

  it("maps a ConvexError with an unknown code without leaking its payload", () => {
    const ui = toUiError(new ConvexError({ code: "NEW_CODE", message: "raw secret" }));

    expect(ui.code).toBe("INTERNAL");
    expect(ui.message).toBe(ERROR_MESSAGES.INTERNAL);
    expect(ui.message).not.toContain("raw secret");
    expect(ui.message).not.toContain("NEW_CODE");
  });

  it("maps a fetch TypeError to NETWORK", () => {
    const ui = toUiError(new TypeError("Failed to fetch"));

    expect(ui.code).toBe("NETWORK");
    expect(ui.message).toBe(ERROR_MESSAGES.NETWORK);
    expect(ui.action).toBe("retry");
  });
});

const AUTH_CASES = [
  ["INVALID_EMAIL_OR_PASSWORD", "INVALID_CREDENTIALS"],
  ["USER_ALREADY_EXISTS", "EMAIL_TAKEN"],
  ["USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "EMAIL_TAKEN"],
  ["TOO_MANY_REQUESTS", "RATE_LIMITED"],
] as const;

const AUTH_SHAPES = {
  "sign-in/sign-up result": (code: string) => ({
    code,
    message: "raw auth server copy",
    status: 400,
    statusText: "Bad Request",
  }),
  APIError: (code: string) =>
    new APIError(400, { code, message: "raw auth server copy" }),
  BetterFetchError: (code: string) =>
    new BetterFetchError(400, "Bad Request", {
      code,
      message: "raw auth server copy",
    }),
} satisfies Record<string, (code: string) => unknown>;

describe("Better Auth errors delegate to auth-errors", () => {
  for (const [shape, make] of Object.entries(AUTH_SHAPES)) {
    it(`maps ${shape} for every known auth code`, () => {
      for (const [authCode, expected] of AUTH_CASES) {
        const ui = toUiError(make(authCode));

        expect(ui.code).toBe(expected);
        expect(ui.message).toBe(ERROR_MESSAGES[expected]);
        expect(ui.message).not.toContain("raw auth server copy");
      }
    });
  }

  it("keeps unmapped auth codes opaque", () => {
    for (const error of [
      new APIError(400, { code: "SOMETHING_NEW", message: "raw secret" }),
      new BetterFetchError(400, "Bad Request", { code: "SOMETHING_NEW" }),
      { code: "SOMETHING_NEW", status: 400, statusText: "Bad Request" },
    ]) {
      const ui = toUiError(error);

      expect(ui.code).toBe("INTERNAL");
      expect(ui.message).toBe(ERROR_MESSAGES.INTERNAL);
      expect(ui.message).not.toContain("raw secret");
    }
  });
});

describe("plain serialized Convex errors", () => {
  it("recovers AUTH_REQUIRED from an error boundary message", () => {
    const ui = toUiError(
      new Error('[CONVEX Q(queries/me:current)] AUTH_REQUIRED\n  Called by client'),
    );

    expect(ui.code).toBe("AUTH_REQUIRED");
    expect(ui.action).toBe("sign-in");
    expect(ui.message).toBe(ERROR_MESSAGES.AUTH_REQUIRED);
  });
});