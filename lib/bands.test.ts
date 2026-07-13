import { describe, expect, test } from "bun:test";

import { PERFORMANCE_BANDS, bandFor, percentileAgainst } from "./bands";

describe("bandFor", () => {
  test("maps corrected medians to their bands", () => {
    expect(bandFor(120).label).toBe("REFLEX");
    expect(bandFor(299).label).toBe("REFLEX");
    expect(bandFor(300).label).toBe("BROADCAST");
    expect(bandFor(499).label).toBe("BROADCAST");
    expect(bandFor(640).label).toBe("HUMAN MEDIAN");
    expect(bandFor(900).label).toBe("THOUGHTFUL");
    expect(bandFor(4000).label).toBe("GEOLOGICAL");
  });

  test("non-finite input falls to the slowest band", () => {
    expect(bandFor(Number.NaN).label).toBe("GEOLOGICAL");
  });

  test("bands are ordered and exhaustive", () => {
    const limits = PERFORMANCE_BANDS.map((band) => band.maxCorrectedMs);
    const sorted = [...limits].sort((a, b) => a - b);
    expect(limits).toEqual(sorted);
    expect(limits.at(-1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("percentileAgainst", () => {
  test("returns share of strictly slower entries", () => {
    expect(percentileAgainst([100, 200, 300, 400], 250)).toBe(50);
    expect(percentileAgainst([100, 200, 300, 400], 50)).toBe(100);
    expect(percentileAgainst([100, 200, 300, 400], 500)).toBe(0);
  });

  test("empty or invalid ladders return null", () => {
    expect(percentileAgainst([], 250)).toBeNull();
    expect(percentileAgainst([Number.NaN], 250)).toBeNull();
    expect(percentileAgainst([100], Number.NaN)).toBeNull();
  });
});
