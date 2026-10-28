import { passwordSchema } from "@saycheese/core/validation";
import { describe, expect, it } from "vitest";

import { revalidateShownError } from "./form-validation";

type Meta = { state: { meta: { errorMap: Record<string, unknown> } } };

function fakeField(errorMap: Record<string, unknown>) {
  const field: Meta & {
    setErrorMap: (map: { onBlur?: undefined; onSubmit?: undefined }) => void;
  } = {
    state: { meta: { errorMap } },
    setErrorMap: () => {
      throw new Error("setErrorMap must not be called without a shown error");
    },
  };
  return field;
}

describe("revalidateShownError", () => {
  it("clears blur and submit slots and reports the current error while typing", () => {
    const field = fakeField({ onBlur: "Password must be at least 12 characters." });
    const cleared: Array<{ onBlur?: undefined; onSubmit?: undefined }> = [];
    field.setErrorMap = (map) => {
      cleared.push(map);
    };

    const message = revalidateShownError(field, passwordSchema, "short");

    expect(message).toBe("Password must be at least 12 characters.");
    expect(cleared).toEqual([{ onBlur: undefined, onSubmit: undefined }]);
  });

  it("clears blur and submit slots and returns undefined once the value is valid", () => {
    const field = fakeField({
      onBlur: "Password must be at least 12 characters.",
      onSubmit: "Password must be at least 12 characters.",
    });
    const cleared: Array<{ onBlur?: undefined; onSubmit?: undefined }> = [];
    field.setErrorMap = (map) => {
      cleared.push(map);
    };

    const message = revalidateShownError(field, passwordSchema, "a".repeat(12));

    expect(message).toBeUndefined();
    expect(cleared).toEqual([{ onBlur: undefined, onSubmit: undefined }]);
  });

  it("does nothing when no error is currently shown", () => {
    const field = fakeField({});

    expect(revalidateShownError(field, passwordSchema, "short")).toBeUndefined();
  });
});