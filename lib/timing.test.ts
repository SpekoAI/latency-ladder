import { describe, expect, test } from "bun:test";

import {
  aggregateRun,
  buildTimingLedger,
  calculateInterruptionReflex,
  correctedTimingRange,
  type RoundTiming,
  type TimingEvent,
} from "./timing";

describe("correctedTimingRange", () => {
  test("treats audio-chain latency as a correction bound", () => {
    expect(correctedTimingRange(280, 70)).toEqual({ minMs: 210, maxMs: 280 });
  });

  test("rejects invalid penalties", () => {
    expect(() => correctedTimingRange(100, -1)).toThrow(RangeError);
    expect(() => correctedTimingRange(100, Number.NaN)).toThrow(TypeError);
  });
});

describe("buildTimingLedger", () => {
  test("derives the user gap and the agent first-audio latency", () => {
    const events: TimingEvent[] = [
      { type: "question_audio_end", roundId: 1, tsMs: 1_000 },
      { type: "user_onset", roundId: 1, tsMs: 1_240 },
      {
        type: "user_answer_text",
        roundId: 1,
        tsMs: 1_700,
        text: "fifteen",
        correct: true,
      },
      { type: "agent_first_audio", roundId: 1, tsMs: 1_880 },
    ];

    const ledger = buildTimingLedger(events, 40);

    expect(ledger.rounds[0]).toMatchObject({
      gapMs: 240,
      correctedGapRangeMs: { minMs: 200, maxMs: 240 },
      agentLatencyMs: 180,
      interruptionLeadMs: null,
    });
    expect(ledger.aggregate).toMatchObject({
      medianMs: 240,
      bestMs: 240,
      correctPct: 100,
    });
  });

  test("is stable for out-of-order events and keeps earliest onset/audio", () => {
    const ledger = buildTimingLedger([
      { type: "agent_first_audio", roundId: "q1", tsMs: 2_000 },
      { type: "user_onset", roundId: "q1", tsMs: 1_350 },
      { type: "question_audio_end", roundId: "q1", tsMs: 1_000 },
      { type: "user_onset", roundId: "q1", tsMs: 1_300 },
      {
        type: "user_answer_text",
        roundId: "q1",
        tsMs: 1_800,
        text: "eight",
        correct: true,
      },
      { type: "agent_first_audio", roundId: "q1", tsMs: 1_950 },
    ]);

    expect(ledger.rounds[0]).toMatchObject({
      userOnsetMs: 1_300,
      agentFirstAudioMs: 1_950,
      gapMs: 300,
      agentLatencyMs: 150,
    });
  });

  test("uses the latest transcript result for correctness", () => {
    const ledger = buildTimingLedger([
      { type: "question_audio_end", roundId: 1, tsMs: 100 },
      { type: "user_onset", roundId: 1, tsMs: 200 },
      {
        type: "user_answer_text",
        roundId: 1,
        tsMs: 300,
        text: "fif",
        correct: false,
      },
      {
        type: "user_answer_text",
        roundId: 1,
        tsMs: 320,
        text: "fifteen",
        correct: true,
      },
    ]);

    expect(ledger.rounds[0]).toMatchObject({
      userAnswerText: "fifteen",
      userAnswerTextMs: 320,
      correct: true,
    });
  });

  test("counts unanswered rounds as incorrect", () => {
    const ledger = buildTimingLedger([
      { type: "question_audio_end", roundId: 1, tsMs: 0 },
      { type: "user_onset", roundId: 1, tsMs: 250 },
      {
        type: "user_answer_text",
        roundId: 1,
        tsMs: 500,
        text: "red",
        correct: true,
      },
      { type: "question_audio_end", roundId: 2, tsMs: 1_000 },
    ]);

    expect(ledger.aggregate).toMatchObject({
      roundCount: 2,
      answeredCount: 1,
      correctCount: 1,
      correctPct: 50,
    });
  });

  test("rejects non-finite event timestamps", () => {
    expect(() =>
      buildTimingLedger([
        { type: "user_onset", roundId: 1, tsMs: Number.POSITIVE_INFINITY },
      ]),
    ).toThrow(TypeError);
  });
});

describe("run aggregates", () => {
  const round = (overrides: Partial<RoundTiming>): RoundTiming => ({
    roundId: 1,
    questionAudioEndMs: 0,
    userOnsetMs: 0,
    userAnswerTextMs: 0,
    userAnswerText: "answer",
    correct: true,
    agentFirstAudioMs: null,
    gapMs: 0,
    correctedGapRangeMs: null,
    agentLatencyMs: null,
    interruptionLeadMs: null,
    ...overrides,
  });

  test("calculates median and best from correct non-interrupted rounds", () => {
    const result = aggregateRun(
      [
        round({ roundId: 1, gapMs: 300 }),
        round({ roundId: 2, gapMs: 100 }),
        round({ roundId: 3, gapMs: 200 }),
        round({ roundId: 4, gapMs: 50, correct: false }),
        round({ roundId: 5, gapMs: -25, interruptionLeadMs: 25 }),
      ],
      20,
    );

    expect(result).toMatchObject({
      medianMs: 200,
      bestMs: 100,
      correctCount: 4,
      timedCorrectCount: 3,
      correctPct: 80,
      correctedMedianRangeMs: { minMs: 180, maxMs: 200 },
      correctedBestRangeMs: { minMs: 80, maxMs: 100 },
    });
  });

  test("keeps negative gaps in the separate interruption reflex stat", () => {
    const rounds = [
      round({ roundId: 1, gapMs: -40, interruptionLeadMs: 40 }),
      round({ roundId: 2, gapMs: 100 }),
      round({ roundId: 3, gapMs: -80, interruptionLeadMs: 80 }),
      round({ roundId: 4, gapMs: null }),
    ];

    const reflex = calculateInterruptionReflex(rounds);

    expect(reflex).toMatchObject({
      count: 2,
      medianLeadMs: 60,
      bestLeadMs: 80,
    });
    expect(reflex.ratePct).toBeCloseTo(200 / 3);
  });
});
