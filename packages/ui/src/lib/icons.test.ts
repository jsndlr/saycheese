import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const UI_SRC = fileURLToPath(new URL("..", import.meta.url));
const WEB_SRC = fileURLToPath(new URL("../../../../apps/web/src", import.meta.url));
const ICON_BARREL = fileURLToPath(new URL("./icons.ts", import.meta.url));

const IGNORED_DIRECTORIES: Record<string, true> = {
  "node_modules": true,
  ".next": true,
  ".turbo": true,
  "dist": true,
  "coverage": true,
};
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx)$/;
const LUCIDE_IMPORT_PATTERN =
  /(?:from\s+["']lucide-react["']|import\s*\(\s*["']lucide-react["']\s*\))/;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES[entry.name] === true) continue;

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe("icon barrel", () => {
  it("is the only module importing lucide-react", () => {
    const offenders = [...sourceFiles(UI_SRC), ...sourceFiles(WEB_SRC)]
      .filter((file) => resolve(file) !== ICON_BARREL)
      .filter((file) => LUCIDE_IMPORT_PATTERN.test(readFileSync(file, "utf8")));

    expect(
      offenders,
      `import icons from "@saycheese/ui/lib/icons" instead of lucide-react in: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});