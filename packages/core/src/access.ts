export const statement = {
  image: ["read", "create", "rescore", "archive"],
  score: ["read"],
  audit: ["read"],
} as const;

export type Resource = keyof typeof statement;

export type Permission = {
  [R in Resource]: { resource: R; action: (typeof statement)[R][number] };
}[Resource];

export const ROLES = ["user", "admin"] as const;

export type Role = (typeof ROLES)[number];

const IMAGE_PERMISSIONS: Permission[] = statement.image.map((action) => ({
  resource: "image" as const,
  action,
}));

const USER_PERMISSIONS: Permission[] = [
  ...IMAGE_PERMISSIONS,
  { resource: "score", action: "read" },
];

export const grants: Record<Role, Permission[]> = {
  user: USER_PERMISSIONS,
  admin: [...USER_PERMISSIONS, { resource: "audit", action: "read" }],
};

function isRole(value: string): value is Role {
  return Object.hasOwn(grants, value);
}

export function can(roles: readonly string[], permission: Permission): boolean {
  return roles.some(
    (role) =>
      isRole(role) &&
      grants[role].some(
        (granted) =>
          granted.resource === permission.resource && granted.action === permission.action,
      ),
  );
}