import { describe, expect, test } from "bun:test";

import { parseRunSubmission, sanitizeHandle } from "./run-api";

describe("sanitizeHandle", () => {
  test("keeps plain ascii handles", () => {
    expect(sanitizeHandle("bek_abdik")).toBe("bek_abdik");
    expect(sanitizeHandle("  @speko dev  ")).toBe("@speko dev");
  });

  test("strips non-ascii and control characters", () => {
    expect(sanitizeHandle("beké—!")).toBe("bek");
  });

  test("caps length at thirty characters", () => {
    expect(sanitizeHandle("a".repeat(60))?.length).toBe(30);
  });

  test("rejects non-strings and too-short results", () => {
    expect(sanitizeHandle(42)).toBeNull();
    expect(sanitizeHandle("!")).toBeNull();
  });
});

describe("parseRunSubmission", () => {
  const valid = {
    handle: "bek",
    humanMsCorrected: 512,
    humanMsRaw: 590,
    agentMs: 238,
    correctPct: 100,
  };

  test("accepts a valid submission", () => {
    const parsed = parseRunSubmission(valid);
    expect(parsed).not.toBeNull();
    expect(parsed?.agentMs).toBe(238);
    expect(parsed?.cohort).toBeNull();
  });

  test("allows a null agent measurement", () => {
    expect(parseRunSubmission({ ...valid, agentMs: null })?.agentMs).toBeNull();
  });

  test("rejects out-of-range numbers", () => {
    expect(parseRunSubmission({ ...valid, humanMsCorrected: 999_999 })).toBeNull();
    expect(parseRunSubmission({ ...valid, correctPct: 140 })).toBeNull();
  });

  test("rejects a missing handle", () => {
    expect(parseRunSubmission({ ...valid, handle: "" })).toBeNull();
  });
});
