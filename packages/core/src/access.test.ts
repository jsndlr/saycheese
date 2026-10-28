import { describe, expect, it } from "vitest";

import { can, grants } from "./access";
import type { Permission } from "./access";

const ALL_PERMISSIONS = [
  { resource: "image", action: "read" },
  { resource: "image", action: "create" },
  { resource: "image", action: "rescore" },
  { resource: "image", action: "archive" },
  { resource: "score", action: "read" },
  { resource: "audit", action: "read" },
] satisfies readonly Permission[];

const IMAGE_AND_SCORE: readonly Permission[] = [
  { resource: "image", action: "read" },
  { resource: "image", action: "create" },
  { resource: "image", action: "rescore" },
  { resource: "image", action: "archive" },
  { resource: "score", action: "read" },
];

describe("can", () => {
  it("grants a user every image action and score read", () => {
    for (const permission of IMAGE_AND_SCORE) {
      expect(can(["user"], permission)).toBe(true);
    }
  });

  it("denies a user audit read", () => {
    expect(can(["user"], { resource: "audit", action: "read" })).toBe(false);
  });

  it("grants an admin every permission across every resource", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(can(["admin"], permission)).toBe(true);
    }
  });

  it("keeps admin as a superset of user", () => {
    for (const permission of grants.user) {
      expect(can(["admin"], permission)).toBe(true);
    }
  });

  it("denies unknown roles", () => {
    expect(can([], { resource: "image", action: "read" })).toBe(false);
    expect(can(["guest"], { resource: "image", action: "read" })).toBe(false);
    expect(can(["Admin"], { resource: "audit", action: "read" })).toBe(false);
    expect(can(["admin "], { resource: "audit", action: "read" })).toBe(false);
  });

  it("unions the listed roles", () => {
    expect(can(["user", "admin"], { resource: "audit", action: "read" })).toBe(true);
    expect(can(["billing", "user"], { resource: "image", action: "archive" })).toBe(true);
    expect(can(["billing", "user"], { resource: "audit", action: "read" })).toBe(false);
  });

  it("requires an exact resource and action match", () => {
    expect(can(["user"], { resource: "score", action: "read" })).toBe(true);
    expect(can(["user"], { resource: "audit", action: "read" })).toBe(false);
    expect(can(["admin"], { resource: "score", action: "read" })).toBe(true);
  });

  it("rejects actions outside the statement at compile time", () => {
    // @ts-expect-error "delete" is not an image action
    expect(can(["admin"], { resource: "image", action: "delete" })).toBe(false);
    // @ts-expect-error "score" only grants read
    expect(can(["admin"], { resource: "score", action: "rescore" })).toBe(false);
    // @ts-expect-error "photo" is not a resource
    expect(can(["admin"], { resource: "photo", action: "read" })).toBe(false);
  });
});