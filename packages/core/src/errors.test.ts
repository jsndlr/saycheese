import { describe, expect, it } from "vitest";

import { ERROR_CODES, ERROR_MESSAGES, errorPayload, isErrorCode } from "./errors";

describe("ERROR_MESSAGES", () => {
  it("has a non-empty, untrimmed-free message for every code", () => {
    for (const code of ERROR_CODES) {
      const message = ERROR_MESSAGES[code];
      expect(message.length).toBeGreaterThan(0);
      expect(message).toBe(message.trim());
    }
  });

  it("maps each code to a distinct message", () => {
    const messages = ERROR_CODES.map((code) => ERROR_MESSAGES[code]);
    expect(new Set(messages).size).toBe(ERROR_CODES.length);
  });
});

describe("isErrorCode", () => {
  it("accepts every declared code", () => {
    for (const code of ERROR_CODES) {
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it("rejects lookalikes", () => {
    const lookalikes = [
      "",
      "AUTH",
      "auth_required",
      "AUTH_REQUIRED ",
      " AUTH_REQUIRED",
      "IMAGE_TOO_BIG",
      "DELETE",
    ];

    for (const value of lookalikes) {
      expect(isErrorCode(value)).toBe(false);
    }
  });
});

describe("errorPayload", () => {
  it("derives the message from the code", () => {
    const payload = errorPayload("RATE_LIMITED");

    expect(payload).toEqual({
      code: "RATE_LIMITED",
      message: ERROR_MESSAGES.RATE_LIMITED,
    });
  });

  it("omits detail entirely when not supplied", () => {
    expect("detail" in errorPayload("NOT_FOUND")).toBe(false);
  });

  it("passes detail through unchanged", () => {
    const detail = { field: "email", retryAfterMs: 30_000 };

    const payload = errorPayload("VALIDATION_FAILED", detail);

    expect(payload.code).toBe("VALIDATION_FAILED");
    expect(payload.message).toBe(ERROR_MESSAGES.VALIDATION_FAILED);
    expect(payload.detail).toEqual(detail);
    expect(payload.detail).toBe(detail);
  });
});