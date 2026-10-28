/**
 * WCAG 2.x contrast utilities for OKLCH colors.
 *
 * OKLCH -> OKLab -> linear sRGB uses Björn Ottosson's matrices
 * (https://bottosson.github.io/posts/oklab/). No color library required.
 */

export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

type LinearRgb = readonly [number, number, number];

const OKLCH_PATTERN =
  /^oklch\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))(%?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))(%?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:deg)?\s*\)$/i;

/** WCAG 2.x relative luminance coefficients for linear sRGB. */
const LUMINANCE_COEFFICIENTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Parses `oklch(L C H)` / `oklch(L% C H)`.
 * Alpha forms (`oklch(... / a)`) are rejected: they cannot be composited
 * without knowing the backdrop, so they have no single contrast ratio.
 */
export function parseOklch(input: string): Oklch {
  const value = input.trim();
  if (value.includes("/")) {
    throw new Error(`parseOklch: alpha channels are not supported: "${input}"`);
  }

  const match = OKLCH_PATTERN.exec(value);
  if (!match) {
    throw new Error(`parseOklch: expected "oklch(L C H)": "${input}"`);
  }

  const lText = match[1] ?? "";
  const lUnit = match[2] ?? "";
  const cText = match[3] ?? "";
  const cUnit = match[4] ?? "";
  const hText = match[5] ?? "";

  const l = Number(lText);
  const c = Number(cText);
  const h = Number(hText);

  const lightness = lUnit === "%" ? l / 100 : l;
  // CSS Color 4: 100% chroma equals 0.4.
  const chroma = cUnit === "%" ? (c / 100) * 0.4 : c;

  if (!Number.isFinite(lightness) || lightness < 0 || lightness > 1) {
    throw new Error(`parseOklch: lightness must be within [0, 1] or [0%, 100%]: "${input}"`);
  }
  if (!Number.isFinite(chroma) || chroma < 0) {
    throw new Error(`parseOklch: chroma must be a non-negative number: "${input}"`);
  }
  if (!Number.isFinite(h)) {
    throw new Error(`parseOklch: hue must be a number: "${input}"`);
  }

  return { l: lightness, c: chroma, h: ((h % 360) + 360) % 360 };
}

/** OKLCH -> non-linear-ish OKLab -> linear sRGB, clamped into [0, 1]. */
export function oklchToLinearRgb(color: Oklch): LinearRgb {
  const hueRadians = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hueRadians);
  const b = color.c * Math.sin(hueRadians);

  const l = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const m = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const s = color.l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;

  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const blue = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return [clamp01(r), clamp01(g), clamp01(blue)];
}

/** WCAG 2.x relative luminance from linear sRGB components. */
export function relativeLuminanceFromLinearRgb([r, g, b]: LinearRgb): number {
  return LUMINANCE_COEFFICIENTS.r * r + LUMINANCE_COEFFICIENTS.g * g + LUMINANCE_COEFFICIENTS.b * b;
}

export function relativeLuminance(color: string): number {
  return relativeLuminanceFromLinearRgb(oklchToLinearRgb(parseOklch(color)));
}

/** WCAG 2.x contrast ratio, 1..21, order-independent. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}