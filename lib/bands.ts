export interface PerformanceBand {
  maxCorrectedMs: number;
  label: string;
  line: string;
}

/**
 * Roast copy by corrected-median band. Delivery flavor only; every number on
 * screen still carries its measurement label.
 */
export const PERFORMANCE_BANDS: readonly PerformanceBand[] = [
  {
    maxCorrectedMs: 300,
    label: "REFLEX",
    line: "You are wasted on meetings.",
  },
  {
    maxCorrectedMs: 500,
    label: "BROADCAST",
    line: "Broadcast grade. Producers would hire you.",
  },
  {
    maxCorrectedMs: 700,
    label: "HUMAN MEDIAN",
    line: "Human median. The agent is not.",
  },
  {
    maxCorrectedMs: 1000,
    label: "THOUGHTFUL",
    line: "Thoughtful. The agent is not paying you by the hour.",
  },
  {
    maxCorrectedMs: Number.POSITIVE_INFINITY,
    label: "GEOLOGICAL",
    line: "The agent answered, ordered lunch, and waited.",
  },
];

export function bandFor(correctedMedianMs: number): PerformanceBand {
  if (!Number.isFinite(correctedMedianMs)) {
    return PERFORMANCE_BANDS[PERFORMANCE_BANDS.length - 1];
  }

  return (
    PERFORMANCE_BANDS.find((band) => correctedMedianMs < band.maxCorrectedMs) ??
    PERFORMANCE_BANDS[PERFORMANCE_BANDS.length - 1]
  );
}

/**
 * Share of ladder entries strictly slower than the given corrected ms.
 * An empty ladder returns null so callers do not print a fake percentile.
 */
export function percentileAgainst(
  ladderCorrectedMs: readonly number[],
  correctedMs: number,
): number | null {
  const valid = ladderCorrectedMs.filter((value) => Number.isFinite(value));

  if (valid.length === 0 || !Number.isFinite(correctedMs)) {
    return null;
  }

  const slower = valid.filter((value) => value > correctedMs).length;
  return Math.round((slower / valid.length) * 100);
}
