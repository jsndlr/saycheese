import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  parseOklch,
  relativeLuminance,
  relativeLuminanceFromLinearRgb,
} from "./contrast";

describe("parseOklch", () => {
  it("parses a numeric lightness", () => {
    expect(parseOklch("oklch(0.556 0 0)")).toEqual({ l: 0.556, c: 0, h: 0 });
  });

  it("parses a percentage lightness", () => {
    expect(parseOklch("oklch(50% 0 0)").l).toBeCloseTo(0.5, 10);
    expect(parseOklch("oklch(100% 0 0)").l).toBeCloseTo(1, 10);
  });

  it("rejects alpha forms", () => {
    expect(() => parseOklch("oklch(0.5 0 0 / 0.5)")).toThrow(/alpha/i);
    expect(() => parseOklch("oklch(0.5 0 0 / 50%)")).toThrow(/alpha/i);
  });

  it("rejects input that is not an oklch() color", () => {
    expect(() => parseOklch("hsl(0 0% 50%)")).toThrow(/oklch/);
    expect(() => parseOklch("oklch(1.2 0 0)")).toThrow(/lightness/);
  });
});

describe("relative luminance", () => {
  it("matches #737373 (neutral-500) within 0.002", () => {
    const channel = 115 / 255;
    const expected = ((channel + 0.055) / 1.055) ** 2.4;

    const actual = relativeLuminance("oklch(0.556 0 0)");
    expect(Math.abs(actual - expected)).toBeLessThan(0.002);
  });

  it("keeps linear channels in gamut", () => {
    // Intense chroma at extreme lightness extrapolates outside sRGB.
    const rgb = relativeLuminanceFromLinearRgb([0, 0, 0]);
    expect(rgb).toBe(0);
    expect(relativeLuminance("oklch(0.9 0.4 140)")).toBeLessThanOrEqual(1);
  });
});

describe("contrastRatio", () => {
  it("is 21 for white on black", () => {
    expect(contrastRatio("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 2);
  });

  it("is 1 for a color against itself", () => {
    expect(contrastRatio("oklch(0.6 0.1 60)", "oklch(0.6 0.1 60)")).toBeCloseTo(1, 10);
  });

  it("is order-independent", () => {
    const a = "oklch(0.2 0 0)";
    const b = "oklch(0.9 0 0)";
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12);
  });
});