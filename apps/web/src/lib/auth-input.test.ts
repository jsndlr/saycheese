import { describe, expect, it } from "vitest";

import { parseSignInInput, parseSignUpInput } from "./auth-input";

describe("parseSignUpInput", () => {
  it("normalizes the email and trims the name", () => {
    const result = parseSignUpInput({
      email: "  A@B.COM ",
      password: "a".repeat(12),
      name: "  Ada Lovelace  ",
    });

    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("a@b.com");
    expect(result.data?.name).toBe("Ada Lovelace");
  });

  it("reports a password below the minimum", () => {
    const result = parseSignUpInput({
      email: "a@b.com",
      password: "a".repeat(11),
      name: "Ada",
    });

    expect(result.success).toBe(false);
  });
});

describe("parseSignInInput", () => {
  it("normalizes the email while keeping short existing passwords valid", () => {
    const result = parseSignInInput({ email: "  A@B.COM ", password: "short" });

    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("a@b.com");
    expect(result.data?.password).toBe("short");
  });

  it("rejects an empty password", () => {
    expect(parseSignInInput({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});