import { ROLES, can } from "@saycheese/core/access";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readWrapperMetadata, WRAPPER_MARKER } from "../convex/functions";
import type { WrapperMetadata } from "../convex/functions";

const CONVEX_DIR = fileURLToPath(new URL("../convex", import.meta.url));

// `convex.config.ts` cannot be imported in node: defineApp().use(component)
// throws outside the Convex runtime. Every other module is loaded, so a new
// file is either covered or fails the explicit skip-list check below.
const SKIPPED = new Map([
  [
    "../convex/convex.config.ts",
    "defineApp().use(component) throws outside the Convex runtime",
  ],
]);

const loaders = import.meta.glob("../convex/**/*.ts") as Record<
  string,
  () => Promise<Record<string, unknown>>
>;

const MODULE_PATHS = Object.keys(loaders)
  .filter((path) => !path.split("/").includes("_generated"))
  .sort((a, b) => a.localeCompare(b));

const MODULE_ENTRIES = (
  await Promise.all(
    MODULE_PATHS.map(
      async (path) =>
        [path.replace(/^\.\.\//, ""), SKIPPED.has(path) ? {} : await loaders[path]()] as const,
    ),
  )
).sort(([a], [b]) => a.localeCompare(b));

const WRAPPER_KIND: Record<WrapperMetadata["wrapper"], "query" | "mutation"> = {
  authedQuery: "query",
  authedMutation: "mutation",
  publicQuery: "query",
};

type PublicFunction = {
  module: string;
  name: string;
  kind: "query" | "mutation" | "action";
  metadata: WrapperMetadata;
};

function publicKind(value: unknown): PublicFunction["kind"] | undefined {
  if (typeof value !== "function") {
    return undefined;
  }
  if (!("isPublic" in value) || value.isPublic !== true) {
    return undefined;
  }
  if ("isQuery" in value && value.isQuery === true) {
    return "query";
  }
  if ("isMutation" in value && value.isMutation === true) {
    return "mutation";
  }
  if ("isAction" in value && value.isAction === true) {
    return "action";
  }
  return undefined;
}

function publicFunctions(): PublicFunction[] {
  const found: PublicFunction[] = [];
  for (const [module, exports] of MODULE_ENTRIES) {
    for (const [name, value] of Object.entries(exports)) {
      const kind = publicKind(value);
      if (kind === undefined) {
        continue;
      }
      const metadata = readWrapperMetadata(value);
      if (metadata !== undefined) {
        found.push({ module, name, kind, metadata });
      }
    }
  }
  return found;
}

function permissionLabel(permission: WrapperMetadata["permission"]): string {
  if (permission === "public" || permission === "signed-in") {
    return permission;
  }
  return `${permission.resource}:${permission.action}`;
}

function rolesFor(permission: WrapperMetadata["permission"]): string {
  if (permission === "public") {
    return "any (anonymous)";
  }
  if (permission === "signed-in") {
    return "any signed-in";
  }
  return ROLES.filter((role) => can([role], permission)).join(", ") || "none";
}

function architectureTable(entries: PublicFunction[]): string {
  const header = "| function | wrapper | permission | roles |";
  const divider = "| --- | --- | --- | --- |";
  const rows = entries.map(
    ({ module, name, metadata }) =>
      `| ${module}:${name} | ${metadata.wrapper} | ${permissionLabel(metadata.permission)} | ${rolesFor(metadata.permission)} |`,
  );
  return [header, divider, ...rows].join("\n");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "_generated" ? [] : sourceFiles(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const IMPORT_PATTERN =
  /import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']*_generated\/server)["']/g;

function forbiddenBuilderImports(source: string): string[] {
  const violations: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const [, bindings, specifier] = match;
    for (const binding of bindings.split(",")) {
      const imported = binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (imported === "query" || imported === "mutation" || imported === "action") {
        violations.push(`${imported} from "${specifier}"`);
      }
    }
  }
  return violations;
}

describe("public function architecture", () => {
  it("only exposes functions built through the tagged wrappers", () => {
    const untagged: string[] = [];
    const mismatched: string[] = [];

    for (const [module, exports] of MODULE_ENTRIES) {
      for (const [name, value] of Object.entries(exports)) {
        const kind = publicKind(value);
        if (kind === undefined) {
          continue;
        }
        const location = `${module}:${name}`;
        const metadata = readWrapperMetadata(value);
        if (metadata === undefined) {
          untagged.push(`${location} is a public ${kind} without a wrapper marker`);
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, WRAPPER_MARKER);
        if (descriptor === undefined || descriptor.enumerable !== false) {
          mismatched.push(`${location} does not hide its wrapper marker from enumeration`);
        }
        if (WRAPPER_KIND[metadata.wrapper] !== kind) {
          mismatched.push(
            `${location} is a public ${kind} but is tagged as ${metadata.wrapper} (${WRAPPER_KIND[metadata.wrapper]})`,
          );
        }
      }
    }

    expect(untagged, untagged.join("\n")).toEqual([]);
    expect(mismatched, mismatched.join("\n")).toEqual([]);
  });

  it("declares a permission for every tagged public function", () => {
    for (const [module, exports] of MODULE_ENTRIES) {
      for (const [name, value] of Object.entries(exports)) {
        if (publicKind(value) === undefined) {
          continue;
        }
        const metadata = readWrapperMetadata(value);
        expect(metadata, `${module}:${name} has no wrapper metadata`).toBeDefined();
        expect(
          metadata?.permission,
          `${module}:${name} declares no permission`,
        ).toBeDefined();
      }
    }
  });

  it("forbids raw query/mutation/action imports outside functions.ts", () => {
    const violations = sourceFiles(CONVEX_DIR)
      .filter((path) => relative(CONVEX_DIR, path) !== "functions.ts")
      .flatMap((path) =>
        forbiddenBuilderImports(readFileSync(path, "utf8")).map(
          (violation) => `${relative(CONVEX_DIR, path).split(sep).join("/")} imports ${violation}`,
        ),
      );

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps the skip list explicit and complete", () => {
    for (const [path, reason] of SKIPPED) {
      expect(MODULE_PATHS, `${path} is skipped (${reason}) but does not exist`).toContain(path);
    }
    const onDisk = sourceFiles(CONVEX_DIR)
      .map((path) => `../convex/${relative(CONVEX_DIR, path).split(sep).join("/")}`)
      .sort((a, b) => a.localeCompare(b));
    expect(MODULE_PATHS).toEqual(onDisk);
  });

  it("snapshots every public function and who may call it", () => {
    expect(architectureTable(publicFunctions())).toMatchInlineSnapshot(`
      "| function | wrapper | permission | roles |
      | --- | --- | --- | --- |
      | convex/auth.ts:getCurrentUser | publicQuery | public | any (anonymous) |
      | convex/healthCheck.ts:get | publicQuery | public | any (anonymous) |
      | convex/queries/me.ts:current | authedQuery | signed-in | any signed-in |"
    `);
  });
});