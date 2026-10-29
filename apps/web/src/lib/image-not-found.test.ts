import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { isImageNotFoundError } from "./image-not-found";

describe("isImageNotFoundError", () => {
  it("maps the query's NOT_FOUND payload", () => {
    expect(
      isImageNotFoundError(
        new ConvexError({ code: "NOT_FOUND", message: "Not found." }),
      ),
    ).toBe(true);
  });

  it("maps an invalid id rejected by the v.id validator", () => {
    expect(
      isImageNotFoundError(
        new ConvexError(
          'ArgumentValidationError: Value does not match validator.\nPath: .id\nValue: "notanid"\nValidator: v.id("images")',
        ),
      ),
    ).toBe(true);
  });

  it("maps the same validation failure when it arrives as a plain error", () => {
    expect(
      isImageNotFoundError(
        new Error(
          '[Request ID: abc] Server Error\nArgumentValidationError: Value does not match validator.\nPath: .id\nValue: "notanid"\nValidator: v.id("images")',
        ),
      ),
    ).toBe(true);
  });

  it("leaves real failures for the error boundary", () => {
    expect(
      isImageNotFoundError(
        new ConvexError({ code: "INTERNAL", message: "Something went wrong." }),
      ),
    ).toBe(false);
    expect(isImageNotFoundError(new Error("socket closed"))).toBe(false);
  });
});
