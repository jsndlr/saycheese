import { describe, expect, it } from "vitest";

import { can, grants, ROLES, statement } from "./access";
import type { Permission, Resource } from "./access";

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
function declaredPermissions(): Permission[] {
  return (Object.keys(statement) as Resource[]).flatMap((resource) =>
    statement[resource].map((action) => ({ resource, action }) as Permission),
  );
}

function label(permission: Permission): string {
  return `${permission.resource}:${permission.action}`;
}

function roleMatrix(): string {
  const permissions = declaredPermissions();
  const header = `| role | ${permissions.map(label).join(" | ")} |`;
  const divider = `| --- | ${permissions.map(() => "---").join(" | ")} |`;
  const rows = ROLES.map(
    (role) => `| ${role} | ${permissions.map((p) => (can([role], p) ? "yes" : "no")).join(" | ")} |`,
  );
  return [header, divider, ...rows].join("\n");
}

describe("permission matrix", () => {
  it("derives every role x statement cell from grants", () => {
    for (const role of ROLES) {
      for (const permission of declaredPermissions()) {
        const granted = grants[role].some(
          (candidate) =>
            candidate.resource === permission.resource && candidate.action === permission.action,
        );
        expect(can([role], permission), `${role} / ${label(permission)}`).toBe(granted);
      }
    }
  });

  it("never grants outside the statement", () => {
    const declared = new Set(declaredPermissions().map(label));
    for (const role of ROLES) {
      for (const permission of grants[role]) {
        expect(declared.has(label(permission)), `${role} / ${label(permission)}`).toBe(true);
      }
    }
  });

  it("denies everything to unknown roles and to no roles", () => {
    for (const permission of declaredPermissions()) {
      expect(can([], permission), label(permission)).toBe(false);
      expect(can(["guest"], permission), label(permission)).toBe(false);
      expect(can(["Admin"], permission), label(permission)).toBe(false);
    }
  });

  it("snapshots the full grants matrix", () => {
    expect(roleMatrix()).toMatchInlineSnapshot(`
      "| role | image:read | image:create | image:rescore | image:archive | score:read | audit:read |
      | --- | --- | --- | --- | --- | --- | --- |
      | user | yes | yes | yes | yes | yes | no |
      | admin | yes | yes | yes | yes | yes | yes |"
    `);
  });
});
