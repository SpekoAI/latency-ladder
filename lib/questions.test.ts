import { describe, expect, test } from "bun:test";

import {
  InvalidRoundTransitionError,
  QUESTIONS,
  createRound,
  getQuestion,
  gradeAnswer,
  matchesExpectedAnswer,
  normalizeAnswer,
  transitionRound,
} from "./questions";

describe("question data", () => {
  test("contains exactly the eight scripted questions", () => {
    expect(QUESTIONS).toHaveLength(8);
    expect(QUESTIONS.map(({ id }) => id)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
      "q6",
      "q7",
      "q8",
    ]);
  });

  test("looks up a question by id", () => {
    expect(getQuestion("q5").prompt).toContain("spider");
  });
});

describe("answer normalization and matching", () => {
  test("normalizes case, punctuation, whitespace, and number words", () => {
    expect(normalizeAnswer("  It'S FIFTEEN!!!  ")).toBe("its 15");
    expect(normalizeAnswer("Eight.")).toBe("8");
  });

  test.each([
    ["q1", "The answer is 15."],
    ["q1", "I think it is fifteen"],
    ["q2", "Maybe Wednesday works."],
    ["q3", "A stop sign is RED, of course."],
    ["q4", "The opposite would be cold."],
    ["q5", "A spider has eight legs."],
    ["q5", "It has 8."],
    ["q6", "That month is January."],
    ["q7", "You mean salt and pepper."],
    ["q8", "We live on planet Earth."],
  ] as const)("accepts a correct answer for %s", (questionId, answer) => {
    expect(matchesExpectedAnswer(getQuestion(questionId), answer)).toBe(true);
  });

  test.each([
    "Monday",
    "tuesday",
    "On WEDNESDAY!",
    "thursday is my answer",
    "Friday.",
    "It could be Saturday",
    "Sunday morning",
  ])("accepts any weekday: %s", (answer) => {
    expect(matchesExpectedAnswer(getQuestion("q2"), answer)).toBe(true);
  });

  test("uses token boundaries rather than substrings", () => {
    expect(matchesExpectedAnswer(getQuestion("q3"), "I am tired")).toBe(
      false,
    );
    expect(matchesExpectedAnswer(getQuestion("q8"), "earthling")).toBe(false);
    expect(matchesExpectedAnswer(getQuestion("q5"), "eighteen")).toBe(false);
  });

  test("rejects blank and incorrect answers", () => {
    expect(matchesExpectedAnswer(getQuestion("q1"), "")).toBe(false);
    expect(matchesExpectedAnswer(getQuestion("q4"), "warm")).toBe(false);
  });
});

describe("DQ logic", () => {
  test("keeps a correct round qualified", () => {
    expect(gradeAnswer(getQuestion("q7"), "pepper please")).toMatchObject({
      correct: true,
      disqualified: false,
      dqReason: null,
    });
  });

  test("disqualifies an incorrect answer", () => {
    expect(gradeAnswer(getQuestion("q7"), "sugar")).toMatchObject({
      correct: false,
      disqualified: true,
      dqReason: "incorrect_answer",
    });
  });
});

describe("round state machine", () => {
  test("moves question_played to listening to answered", () => {
    const played = createRound(getQuestion("q1"), 100);
    const listening = transitionRound(played, {
      type: "start_listening",
      atMs: 200,
    });
    const answered = transitionRound(listening, {
      type: "submit_answer",
      answerText: "It is fifteen.",
      atMs: 450,
    });

    expect(played.status).toBe("question_played");
    expect(listening).toMatchObject({
      status: "listening",
      listeningStartedAtMs: 200,
    });
    expect(answered).toMatchObject({
      status: "answered",
      answeredAtMs: 450,
      correct: true,
      disqualified: false,
    });
  });

  test("moves listening to timeout without treating it as a wrong-answer DQ", () => {
    const listening = transitionRound(createRound(getQuestion("q2"), 0), {
      type: "start_listening",
      atMs: 1,
    });
    const timeout = transitionRound(listening, {
      type: "timeout",
      atMs: 10_001,
    });

    expect(timeout).toMatchObject({
      status: "timeout",
      timedOutAtMs: 10_001,
      correct: false,
      disqualified: false,
      dqReason: null,
    });
  });

  test("records a wrong submitted answer as an answered DQ", () => {
    const listening = transitionRound(createRound(getQuestion("q3"), 10), {
      type: "start_listening",
      atMs: 20,
    });
    const answered = transitionRound(listening, {
      type: "submit_answer",
      answerText: "blue",
      atMs: 30,
    });

    expect(answered).toMatchObject({
      status: "answered",
      correct: false,
      disqualified: true,
      dqReason: "incorrect_answer",
    });
  });

  test("guards skipped and terminal transitions", () => {
    const played = createRound(getQuestion("q4"), 0);
    expect(() =>
      transitionRound(played, {
        type: "submit_answer",
        answerText: "cold",
        atMs: 1,
      }),
    ).toThrow(InvalidRoundTransitionError);

    const listening = transitionRound(played, {
      type: "start_listening",
      atMs: 1,
    });
    const answered = transitionRound(listening, {
      type: "submit_answer",
      answerText: "cold",
      atMs: 2,
    });

    expect(() =>
      transitionRound(answered, { type: "timeout", atMs: 3 }),
    ).toThrow("Cannot apply timeout while round is answered");
  });

  test("rejects invalid and non-monotonic timestamps", () => {
    expect(() => createRound(getQuestion("q1"), Number.NaN)).toThrow(
      RangeError,
    );

    const played = createRound(getQuestion("q1"), 100);
    expect(() =>
      transitionRound(played, { type: "start_listening", atMs: 99 }),
    ).toThrow("Round timestamps must be monotonic");
  });
});
