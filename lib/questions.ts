export const QUESTION_IDS = [
  "q1",
  "q2",
  "q3",
  "q4",
  "q5",
  "q6",
  "q7",
  "q8",
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

export interface Question {
  id: QuestionId;
  prompt: string;
  expectedAnswers: readonly string[];
}

export const QUESTIONS = [
  {
    id: "q1",
    prompt: "What is seven plus eight?",
    expectedAnswers: ["15", "fifteen"],
  },
  {
    id: "q2",
    prompt: "Name any day of the week.",
    expectedAnswers: [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ],
  },
  {
    id: "q3",
    prompt: "What color is a stop sign?",
    expectedAnswers: ["red"],
  },
  {
    id: "q4",
    prompt: "What is the opposite of hot?",
    expectedAnswers: ["cold"],
  },
  {
    id: "q5",
    prompt: "How many legs does a spider have?",
    expectedAnswers: ["8", "eight"],
  },
  {
    id: "q6",
    prompt: "What is the first month of the year?",
    expectedAnswers: ["january"],
  },
  {
    id: "q7",
    prompt: "Complete the phrase: salt and what?",
    expectedAnswers: ["pepper"],
  },
  {
    id: "q8",
    prompt: "What planet do we live on?",
    expectedAnswers: ["earth"],
  },
] as const satisfies readonly Question[];

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};

/**
 * Produces a token-comparable answer while preserving word boundaries.
 * Number words are canonicalized so speech-to-text output such as "eight"
 * behaves the same as "8".
 */
export function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => NUMBER_WORDS[token] ?? token)
    .join(" ");
}

export function getQuestion(questionId: QuestionId): Question {
  const question = QUESTIONS.find(({ id }) => id === questionId);

  if (!question) {
    throw new Error(`Unknown question: ${questionId}`);
  }

  return question;
}

function containsTokenSequence(answer: string, expected: string): boolean {
  if (!answer || !expected) {
    return false;
  }

  const answerTokens = answer.split(" ");
  const expectedTokens = expected.split(" ");

  return answerTokens.some((_, startIndex) =>
    expectedTokens.every(
      (expectedToken, offset) =>
        answerTokens[startIndex + offset] === expectedToken,
    ),
  );
}

export function matchesExpectedAnswer(
  question: Question,
  answer: string,
): boolean {
  const normalizedAnswer = normalizeAnswer(answer);

  return question.expectedAnswers.some((expected) =>
    containsTokenSequence(normalizedAnswer, normalizeAnswer(expected)),
  );
}

export interface AnswerGrade {
  answerText: string;
  normalizedAnswer: string;
  correct: boolean;
  disqualified: boolean;
  dqReason: "incorrect_answer" | null;
}

export function gradeAnswer(
  question: Question,
  answerText: string,
): AnswerGrade {
  const correct = matchesExpectedAnswer(question, answerText);

  return {
    answerText,
    normalizedAnswer: normalizeAnswer(answerText),
    correct,
    disqualified: !correct,
    dqReason: correct ? null : "incorrect_answer",
  };
}

interface RoundBase {
  question: Question;
  questionPlayedAtMs: number;
}

export interface QuestionPlayedRound extends RoundBase {
  status: "question_played";
}

export interface ListeningRound extends RoundBase {
  status: "listening";
  listeningStartedAtMs: number;
}

export interface AnsweredRound extends RoundBase, AnswerGrade {
  status: "answered";
  listeningStartedAtMs: number;
  answeredAtMs: number;
}

export interface TimedOutRound extends RoundBase {
  status: "timeout";
  listeningStartedAtMs: number;
  timedOutAtMs: number;
  correct: false;
  disqualified: false;
  dqReason: null;
}

export type RoundState =
  | QuestionPlayedRound
  | ListeningRound
  | AnsweredRound
  | TimedOutRound;

export type RoundEvent =
  | { type: "start_listening"; atMs: number }
  | { type: "submit_answer"; answerText: string; atMs: number }
  | { type: "timeout"; atMs: number };

export class InvalidRoundTransitionError extends Error {
  constructor(status: RoundState["status"], eventType: RoundEvent["type"]) {
    super(`Cannot apply ${eventType} while round is ${status}`);
    this.name = "InvalidRoundTransitionError";
  }
}

function assertTimestamp(atMs: number, minimumMs?: number): void {
  if (!Number.isFinite(atMs) || atMs < 0) {
    throw new RangeError("Round timestamps must be finite and non-negative");
  }

  if (minimumMs !== undefined && atMs < minimumMs) {
    throw new RangeError("Round timestamps must be monotonic");
  }
}

export function createRound(
  question: Question,
  questionPlayedAtMs: number,
): QuestionPlayedRound {
  assertTimestamp(questionPlayedAtMs);

  return {
    status: "question_played",
    question,
    questionPlayedAtMs,
  };
}

export function transitionRound(
  state: RoundState,
  event: RoundEvent,
): RoundState {
  if (state.status === "question_played" && event.type === "start_listening") {
    assertTimestamp(event.atMs, state.questionPlayedAtMs);

    return {
      ...state,
      status: "listening",
      listeningStartedAtMs: event.atMs,
    };
  }

  if (state.status === "listening" && event.type === "submit_answer") {
    assertTimestamp(event.atMs, state.listeningStartedAtMs);

    return {
      ...state,
      ...gradeAnswer(state.question, event.answerText),
      status: "answered",
      answeredAtMs: event.atMs,
    };
  }

  if (state.status === "listening" && event.type === "timeout") {
    assertTimestamp(event.atMs, state.listeningStartedAtMs);

    return {
      ...state,
      status: "timeout",
      timedOutAtMs: event.atMs,
      correct: false,
      disqualified: false,
      dqReason: null,
    };
  }

  throw new InvalidRoundTransitionError(state.status, event.type);
}
