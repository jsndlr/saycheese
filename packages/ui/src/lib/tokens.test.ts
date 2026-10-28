import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";

/**
 * T-A11Y-01: token contrasts are a product requirement, so they are checked
 * against the real stylesheet rather than a duplicate list of colors.
 */
const TOKENS_CSS_URL = new URL("../styles/tokens.css", import.meta.url);

function tokensFor(selector: ":root" | ".dark"): Map<string, string> {
  const css = readFileSync(TOKENS_CSS_URL, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) {
    throw new Error(`tokens.css: missing "${selector}" block`);
  }

  const tokens = new Map<string, string>();
  for (const declaration of (block[1] ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;

    const name = declaration.slice(0, separator).trim();
    if (!name.startsWith("--")) continue;

    tokens.set(name.slice(2), declaration.slice(separator + 1).trim());
  }
  return tokens;
}

const THEMES = [
  { name: "light", selector: ":root" },
  { name: "dark", selector: ".dark" },
] as const;

/** [foreground, background] pairs rendered as text. */
const TEXT_PAIRS = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["primary-text", "background"],
  ["primary-text", "card"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["destructive-foreground", "destructive"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["destructive", "popover"],
  ["success-foreground", "success"],
  ["warning-foreground", "warning"],
] as const;

/** [non-text, background] pairs: focus rings need 3:1, not 4.5:1. */
const NON_TEXT_PAIRS = [["ring", "background"]] as const;

describe.each(THEMES)("$name theme tokens (T-A11Y-01)", ({ name, selector }) => {
  const tokens = tokensFor(selector);

  function pairRatio(foreground: string, background: string): number {
    const fg = tokens.get(foreground);
    const bg = tokens.get(background);
    if (fg === undefined || bg === undefined) {
      const missing = [
        ...(fg === undefined ? [`--${foreground}`] : []),
        ...(bg === undefined ? [`--${background}`] : []),
      ].join(", ");
      throw new Error(
        `${name} theme: pair ${foreground}/${background} is missing token(s): ${missing}`,
      );
    }
    return contrastRatio(fg, bg);
  }

  it.each(TEXT_PAIRS)("%s on %s meets WCAG AA (>= 4.5:1)", (foreground, background) => {
    const ratio = pairRatio(foreground, background);
    expect(
      ratio,
      `${name} theme: ${foreground} on ${background} = ${ratio.toFixed(2)}:1, needs >= 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s on %s meets WCAG AA non-text (>= 3:1)", (foreground, background) => {
    const ratio = pairRatio(foreground, background);
    expect(
      ratio,
      `${name} theme: ${foreground} on ${background} = ${ratio.toFixed(2)}:1, needs >= 3:1`,
    ).toBeGreaterThanOrEqual(3);
  });
});