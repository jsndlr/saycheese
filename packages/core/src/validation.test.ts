import { describe, expect, it } from "vitest";

import {
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  emailSchema,
  nameSchema,
  passwordSchema,
  safeNextPath,
  signInSchema,
  signUpSchema,
} from "./validation";

describe("T-AUTH-01 emailSchema", () => {
  it("trims and lowercases a valid address", () => {
    expect(emailSchema.parse("  Foo.Bar+tag@Example.COM  ")).toBe("foo.bar+tag@example.com");
  });

  it("rejects malformed addresses", () => {
    for (const value of ["", "nope", "a@", "@example.com", "a b@example.com"]) {
      expect(emailSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("T-AUTH-01 passwordSchema", () => {
  it("rejects 11 characters and accepts 12, 13 and 200", () => {
    expect(passwordSchema.safeParse("a".repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(13)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(200)).success).toBe(true);
  });

  it("rejects 201 characters", () => {
    expect(passwordSchema.safeParse("a".repeat(201)).success).toBe(false);
  });

  it("imposes no composition rules", () => {
    expect(passwordSchema.safeParse("aaaaaaaaaaaa").success).toBe(true);
  });
});

describe("T-AUTH-01 nameSchema", () => {
  it("trims and rejects blank input", () => {
    expect(nameSchema.parse("  Ada Lovelace  ")).toBe("Ada Lovelace");
    expect(nameSchema.safeParse("   ").success).toBe(false);
  });

  it("accepts 80 characters and rejects 81", () => {
    expect(nameSchema.safeParse("n".repeat(NAME_MAX_LENGTH)).success).toBe(true);
    expect(nameSchema.safeParse("n".repeat(NAME_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe("T-AUTH-01 signInSchema", () => {
  it("accepts a short existing password so Better Auth can reject credentials", () => {
    const result = signInSchema.safeParse({ email: "  A@B.CO ", password: "short" });
    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("a@b.co");
  });

  it("rejects an empty password and one longer than the maximum", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(
      signInSchema.safeParse({ email: "a@b.co", password: "a".repeat(PASSWORD_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });
});

describe("T-AUTH-01 signUpSchema", () => {
  it("normalises email and name while accepting a valid password", () => {
    expect(
      signUpSchema.parse({
        email: " New@Example.COM ",
        password: "a".repeat(12),
        name: "  Ada  ",
      }),
    ).toEqual({ email: "new@example.com", password: "a".repeat(12), name: "Ada" });
  });

  it("rejects a password below the minimum", () => {
    expect(
      signUpSchema.safeParse({ email: "a@b.co", password: "a".repeat(11), name: "Ada" }).success,
    ).toBe(false);
  });
});

describe("T-AUTH-01 safeNextPath", () => {
  it("keeps same-origin relative paths verbatim", () => {
    for (const value of ["/app", "/app?tab=recent", "/", "/app#top", "/a%20b"]) {
      expect(safeNextPath(value)).toBe(value);
    }
  });

  it("rejects absolute and protocol-relative targets", () => {
    for (const value of [
      "//evil.com",
      "///evil.com",
      "http://evil.com",
      "https://evil.com/app",
      "javascript:alert(1)",
      "app",
      "",
    ]) {
      expect(safeNextPath(value)).toBe("/app");
    }
  });

  it("rejects backslash variants", () => {
    for (const value of ["/\\evil.com", "\\\\evil.com", "/%5Cevil.com", "/%5cevil.com"]) {
      expect(safeNextPath(value)).toBe("/app");
    }
  });

  it("rejects encoded protocol-relative and double-encoded variants", () => {
    for (const value of ["/%2F%2Fevil.com", "/%2f%2fevil.com", "/%252F%252Fevil.com"]) {
      expect(safeNextPath(value)).toBe("/app");
    }
  });

  it("rejects control characters and malformed escapes", () => {
    for (const value of ["/\t/evil.com", "/app\n", "/%0d%0aSet-Cookie:x", "/%zz"]) {
      expect(safeNextPath(value)).toBe("/app");
    }
  });

  it("rejects non-string input", () => {
    for (const value of [undefined, null, 42, {}, ["/app"]]) {
      expect(safeNextPath(value)).toBe("/app");
    }
  });
});
