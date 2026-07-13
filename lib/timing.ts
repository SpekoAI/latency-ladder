export type RoundId = string | number;

export type TimingEvent =
  | {
      type: "question_audio_end";
      roundId: RoundId;
      tsMs: number;
    }
  | {
      type: "user_onset";
      roundId: RoundId;
      tsMs: number;
    }
  | {
      type: "user_answer_text";
      roundId: RoundId;
      tsMs: number;
      text: string;
      correct: boolean;
    }
  | {
      type: "agent_first_audio";
      roundId: RoundId;
      tsMs: number;
    };

export interface TimingRange {
  minMs: number;
  maxMs: number;
}

export interface RoundTiming {
  roundId: RoundId;
  questionAudioEndMs: number | null;
  userOnsetMs: number | null;
  userAnswerTextMs: number | null;
  userAnswerText: string | null;
  correct: boolean | null;
  agentFirstAudioMs: number | null;
  gapMs: number | null;
  correctedGapRangeMs: TimingRange | null;
  agentLatencyMs: number | null;
  interruptionLeadMs: number | null;
}

export interface RunAggregate {
  roundCount: number;
  answeredCount: number;
  correctCount: number;
  timedCorrectCount: number;
  medianMs: number | null;
  bestMs: number | null;
  correctPct: number;
  correctedMedianRangeMs: TimingRange | null;
  correctedBestRangeMs: TimingRange | null;
}

export interface InterruptionReflex {
  count: number;
  ratePct: number;
  medianLeadMs: number | null;
  bestLeadMs: number | null;
}

export interface TimingLedger {
  rounds: RoundTiming[];
  aggregate: RunAggregate;
  interruptionReflex: InterruptionReflex;
}

interface MutableRound {
  roundId: RoundId;
  questionAudioEndMs: number | null;
  userOnsetMs: number | null;
  userAnswerTextMs: number | null;
  userAnswerText: string | null;
  correct: boolean | null;
  agentFirstAudioMs: number | null;
}

function assertFiniteMs(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function assertPenalty(audioChainPenaltyMs: number): void {
  assertFiniteMs(audioChainPenaltyMs, "audioChainPenaltyMs");

  if (audioChainPenaltyMs < 0) {
    throw new RangeError("audioChainPenaltyMs must be greater than or equal to zero");
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);

  if (ordered.length % 2 === 1) {
    return ordered[middle];
  }

  return (ordered[middle - 1] + ordered[middle]) / 2;
}

/**
 * Returns the plausible true gap when the measured audio chain can add up to
 * audioChainPenaltyMs. The raw measurement remains the upper bound so callers
 * do not present calibration as more precise than it is.
 */
export function correctedTimingRange(
  measuredMs: number,
  audioChainPenaltyMs: number,
): TimingRange {
  assertFiniteMs(measuredMs, "measuredMs");
  assertPenalty(audioChainPenaltyMs);

  return {
    minMs: measuredMs - audioChainPenaltyMs,
    maxMs: measuredMs,
  };
}

function earliest(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}

function createMutableRound(roundId: RoundId): MutableRound {
  return {
    roundId,
    questionAudioEndMs: null,
    userOnsetMs: null,
    userAnswerTextMs: null,
    userAnswerText: null,
    correct: null,
    agentFirstAudioMs: null,
  };
}

function finishRound(round: MutableRound, audioChainPenaltyMs: number): RoundTiming {
  const gapMs =
    round.questionAudioEndMs === null || round.userOnsetMs === null
      ? null
      : round.userOnsetMs - round.questionAudioEndMs;
  const agentLatencyMs =
    round.userAnswerTextMs === null || round.agentFirstAudioMs === null
      ? null
      : round.agentFirstAudioMs - round.userAnswerTextMs;

  return {
    ...round,
    gapMs,
    correctedGapRangeMs:
      gapMs === null ? null : correctedTimingRange(gapMs, audioChainPenaltyMs),
    agentLatencyMs,
    interruptionLeadMs: gapMs !== null && gapMs < 0 ? Math.abs(gapMs) : null,
  };
}

export function aggregateRun(
  rounds: readonly RoundTiming[],
  audioChainPenaltyMs = 0,
): RunAggregate {
  assertPenalty(audioChainPenaltyMs);

  const correctGaps = rounds.flatMap((round) =>
    round.correct === true && round.gapMs !== null && round.gapMs >= 0
      ? [round.gapMs]
      : [],
  );
  const medianMs = median(correctGaps);
  const bestMs = correctGaps.length === 0 ? null : Math.min(...correctGaps);
  const correctCount = rounds.filter((round) => round.correct === true).length;

  return {
    roundCount: rounds.length,
    answeredCount: rounds.filter((round) => round.userAnswerText !== null).length,
    correctCount,
    timedCorrectCount: correctGaps.length,
    medianMs,
    bestMs,
    correctPct: rounds.length === 0 ? 0 : (correctCount / rounds.length) * 100,
    correctedMedianRangeMs:
      medianMs === null ? null : correctedTimingRange(medianMs, audioChainPenaltyMs),
    correctedBestRangeMs:
      bestMs === null ? null : correctedTimingRange(bestMs, audioChainPenaltyMs),
  };
}

export function calculateInterruptionReflex(
  rounds: readonly RoundTiming[],
): InterruptionReflex {
  const timedRounds = rounds.filter((round) => round.gapMs !== null);
  const leads = timedRounds.flatMap((round) =>
    round.interruptionLeadMs === null ? [] : [round.interruptionLeadMs],
  );

  return {
    count: leads.length,
    ratePct: timedRounds.length === 0 ? 0 : (leads.length / timedRounds.length) * 100,
    medianLeadMs: median(leads),
    bestLeadMs: leads.length === 0 ? null : Math.max(...leads),
  };
}

/**
 * Builds a deterministic ledger from events that may arrive out of order.
 * The first timestamp wins for onset and first-audio events. A later answer
 * event replaces an earlier partial transcript so the final correctness result
 * is reflected in the run aggregate.
 */
export function buildTimingLedger(
  events: readonly TimingEvent[],
  audioChainPenaltyMs = 0,
): TimingLedger {
  assertPenalty(audioChainPenaltyMs);

  const byRound = new Map<RoundId, MutableRound>();

  for (const event of events) {
    assertFiniteMs(event.tsMs, `${event.type}.tsMs`);
    const round = byRound.get(event.roundId) ?? createMutableRound(event.roundId);
    byRound.set(event.roundId, round);

    switch (event.type) {
      case "question_audio_end":
        round.questionAudioEndMs = earliest(round.questionAudioEndMs, event.tsMs);
        break;
      case "user_onset":
        round.userOnsetMs = earliest(round.userOnsetMs, event.tsMs);
        break;
      case "user_answer_text":
        if (round.userAnswerTextMs === null || event.tsMs >= round.userAnswerTextMs) {
          round.userAnswerTextMs = event.tsMs;
          round.userAnswerText = event.text;
          round.correct = event.correct;
        }
        break;
      case "agent_first_audio":
        round.agentFirstAudioMs = earliest(round.agentFirstAudioMs, event.tsMs);
        break;
    }
  }

  const rounds = Array.from(byRound.values(), (round) =>
    finishRound(round, audioChainPenaltyMs),
  );

  return {
    rounds,
    aggregate: aggregateRun(rounds, audioChainPenaltyMs),
    interruptionReflex: calculateInterruptionReflex(rounds),
  };
}
