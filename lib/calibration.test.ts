import { describe, expect, test } from "bun:test";

import {
  calibrationLatencyMs,
  estimateAudioChainPenaltyMs,
  summarizeCalibration,
  type CalibrationSample,
} from "./calibration";

const sample = (latencyMs: number, startMs = 1_000): CalibrationSample => ({
  scheduledBeepTsMs: startMs,
  detectedEchoTsMs: startMs + latencyMs,
});

describe("calibrationLatencyMs", () => {
  test("derives latency from timestamps on the AudioContext clock", () => {
    expect(calibrationLatencyMs(sample(73.5))).toBe(73.5);
  });

  test("rejects an onset before the scheduled beep", () => {
    expect(() =>
      calibrationLatencyMs({ scheduledBeepTsMs: 100, detectedEchoTsMs: 99 }),
    ).toThrow(RangeError);
  });

  test("rejects non-finite timestamps", () => {
    expect(() =>
      calibrationLatencyMs({
        scheduledBeepTsMs: Number.NaN,
        detectedEchoTsMs: 100,
      }),
    ).toThrow(TypeError);
  });
});

describe("estimateAudioChainPenaltyMs", () => {
  test("uses the median to reject a noisy measurement", () => {
    expect(
      estimateAudioChainPenaltyMs([sample(60), sample(62), sample(400)]),
    ).toBe(62);
  });

  test("averages the middle pair for an even sample count", () => {
    expect(
      estimateAudioChainPenaltyMs([
        sample(50),
        sample(70),
        sample(60),
        sample(80),
      ]),
    ).toBe(65);
  });

  test("requires at least one sample", () => {
    expect(() => estimateAudioChainPenaltyMs([])).toThrow(RangeError);
  });
});

describe("summarizeCalibration", () => {
  test("reports penalty, range, and jitter", () => {
    expect(summarizeCalibration([sample(55), sample(65), sample(60)])).toEqual({
      penaltyMs: 60,
      sampleCount: 3,
      minMs: 55,
      maxMs: 65,
      jitterMs: 10,
    });
  });
});
