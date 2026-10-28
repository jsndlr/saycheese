import { describe, expect, it } from "vitest";

import {
  MAX_EDGE,
  MAX_UPLOAD_BYTES,
  MIN_EDGE,
  dimensionViolation,
  exceedsByteCap,
} from "./limits";

describe("exceedsByteCap", () => {
  it("allows exactly 8 MB", () => {
    expect(exceedsByteCap(0)).toBe(false);
    expect(exceedsByteCap(MAX_UPLOAD_BYTES - 1)).toBe(false);
    expect(exceedsByteCap(MAX_UPLOAD_BYTES)).toBe(false);
  });

  it("rejects one byte over 8 MB", () => {
    expect(exceedsByteCap(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });
});

describe("dimensionViolation", () => {
  it("accepts an image at the longest-edge cap", () => {
    expect(dimensionViolation(MAX_EDGE, MIN_EDGE)).toBeNull();
    expect(dimensionViolation(MIN_EDGE, MAX_EDGE)).toBeNull();
  });

  it("rejects one pixel past the longest-edge cap", () => {
    expect(dimensionViolation(MAX_EDGE + 1, MIN_EDGE)).toBe("IMAGE_TOO_LARGE");
    expect(dimensionViolation(MIN_EDGE, MAX_EDGE + 1)).toBe("IMAGE_TOO_LARGE");
  });

  it("accepts exactly 20 megapixels", () => {
    expect(dimensionViolation(5000, 4000)).toBeNull();
    expect(dimensionViolation(4000, 5000)).toBeNull();
  });

  it("rejects one pixel past 20 megapixels", () => {
    expect(dimensionViolation(5000, 4001)).toBe("IMAGE_TOO_LARGE");
  });

  it("accepts an image at the minimum edge", () => {
    expect(dimensionViolation(MIN_EDGE, MIN_EDGE)).toBeNull();
  });

  it("rejects an image one pixel under the minimum edge", () => {
    expect(dimensionViolation(MIN_EDGE - 1, MIN_EDGE)).toBe("IMAGE_TOO_SMALL");
    expect(dimensionViolation(MIN_EDGE, MIN_EDGE - 1)).toBe("IMAGE_TOO_SMALL");
  });

  it("rejects a zero dimension", () => {
    expect(dimensionViolation(0, 100)).toBe("IMAGE_TOO_SMALL");
    expect(dimensionViolation(100, 0)).toBe("IMAGE_TOO_SMALL");
  });

  it("rejects non-finite dimensions", () => {
    expect(dimensionViolation(Number.NaN, 100)).toBe("IMAGE_TOO_SMALL");
    expect(dimensionViolation(100, Number.NaN)).toBe("IMAGE_TOO_SMALL");
    expect(dimensionViolation(Number.POSITIVE_INFINITY, 100)).toBe("IMAGE_TOO_SMALL");
  });

  it("reports TOO_LARGE before TOO_SMALL for thin over-long images", () => {
    // 1x15000 breaks the minimum edge but exceeds the maximum edge: too large wins.
    expect(dimensionViolation(1, 15_000)).toBe("IMAGE_TOO_LARGE");
    expect(dimensionViolation(15_000, 1)).toBe("IMAGE_TOO_LARGE");
  });

  it("reports TOO_SMALL when pixels are fine but an edge is under the minimum", () => {
    expect(dimensionViolation(63, 63)).toBe("IMAGE_TOO_SMALL");
  });
});