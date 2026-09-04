import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeMultipleChoice,
  normaliseAnswerText,
  prepareQuiz,
  scorePercent,
  toLearnerQuiz,
  unanswered,
  type GradedAnswer,
  type StoredQuestion,
} from "./grading";
import type { QuizQuestion } from "./types";

/**
 * Regression tests for H10. The quiz went to the browser with its
 * `correctAnswer` intact, multiple choice was graded by exact string
 * equality, and the browser's verdict was what got written to the learner's
 * history.
 */

const mcq = (overrides: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id: "ignored",
  type: "mcq",
  question: "What is 2 + 2?",
  options: ["3", "4", "5"],
  correctAnswer: "4",
  conceptTag: "addition",
  ...overrides,
});

// --- The key must not reach the browser ----------------------------------

test("the learner projection carries no answer key at all", () => {
  const { stored } = prepareQuiz([
    mcq(),
    { id: "x", type: "short", question: "Why?", correctAnswer: "Because", conceptTag: "reasons" },
  ]);
  const learner = toLearnerQuiz(stored);

  // Absent, not blanked: a key that is merely emptied tends to come back.
  const serialised = JSON.stringify(learner);
  assert.ok(!serialised.includes("correctAnswer"), serialised);
  assert.ok(!serialised.includes("correctOptionId"), serialised);
  assert.ok(!serialised.includes("Because"), serialised);
  for (const question of learner) {
    assert.ok(!("correctAnswer" in question));
    assert.ok(!("correctOptionId" in question));
  }
});

test("the learner still gets everything needed to answer", () => {
  const { stored } = prepareQuiz([mcq()]);
  const [question] = toLearnerQuiz(stored);
  assert.equal(question.id, "q1");
  assert.equal(question.question, "What is 2 + 2?");
  assert.deepEqual(question.options, [
    { id: "o1", text: "3" },
    { id: "o2", text: "4" },
    { id: "o3", text: "5" },
  ]);
});

// --- Resolving the key ----------------------------------------------------

test("the correct option is resolved once, when the quiz is stored", () => {
  const { stored } = prepareQuiz([mcq()]);
  assert.equal(stored[0].correctOptionId, "o2");
});

test("a labelled or punctuated key still matches its option", () => {
  for (const correctAnswer of ["4", " 4 ", "4.", "B) 4", "b. 4", "2. 4"]) {
    const { stored, dropped } = prepareQuiz([mcq({ correctAnswer })]);
    assert.equal(dropped, 0, correctAnswer);
    assert.equal(stored[0].correctOptionId, "o2", correctAnswer);
  }
});

test("a question whose answer matches none of its options is dropped", () => {
  // Every learner would be marked wrong whatever they picked, so keeping it
  // would put an ungradeable item in a permanent record.
  const { stored, dropped } = prepareQuiz([mcq({ correctAnswer: "seven" })]);
  assert.equal(stored.length, 0);
  assert.equal(dropped, 1);
});

test("malformed questions are dropped rather than half-stored", () => {
  const { stored, dropped } = prepareQuiz([
    mcq({ options: ["only one"] }),
    mcq({ correctAnswer: undefined }),
    { id: "s", type: "short", question: "Why?", conceptTag: "c" },
  ]);
  assert.equal(stored.length, 0);
  assert.equal(dropped, 3);
});

test("ids are stable and positional", () => {
  const { stored } = prepareQuiz([mcq(), mcq(), mcq()]);
  assert.deepEqual(
    stored.map((q) => q.id),
    ["q1", "q2", "q3"]
  );
});

test("normalisation never changes the meaning of an answer", () => {
  assert.equal(normaliseAnswerText("  The Mitochondria.  "), "the mitochondria");
  assert.equal(normaliseAnswerText("a) Photosynthesis"), "photosynthesis");
  assert.equal(normaliseAnswerText("two  spaces"), "two spaces");
  // Not so aggressive that two genuinely different answers collapse together.
  assert.notEqual(normaliseAnswerText("4"), normaliseAnswerText("40"));
  assert.notEqual(normaliseAnswerText("acid"), normaliseAnswerText("acidic"));
});

// --- Grading --------------------------------------------------------------

const storedMcq: StoredQuestion = {
  id: "q1",
  type: "mcq",
  question: "What is 2 + 2?",
  options: [
    { id: "o1", text: "3" },
    { id: "o2", text: "4" },
  ],
  correctOptionId: "o2",
  conceptTag: "addition",
};

test("the right option is marked correct, the wrong one is not", () => {
  const right = gradeMultipleChoice(storedMcq, { questionId: "q1", optionId: "o2" });
  assert.equal(right.correct, true);
  assert.equal(right.partialCredit, 1);
  assert.equal(right.studentAnswer, "4");
  assert.equal(right.gradedBy, "deterministic");

  const wrong = gradeMultipleChoice(storedMcq, { questionId: "q1", optionId: "o1" });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.studentAnswer, "3");
});

test("a submitted answer cannot assert its own correctness", () => {
  // The old client sent `{ correct: true }`. Nothing of the sort is read here:
  // only the option id decides, and an unknown id is not an answer.
  const forged = gradeMultipleChoice(storedMcq, {
    questionId: "q1",
    optionId: "o2-but-actually-wrong",
  } as never);
  assert.equal(forged.correct, false);
  assert.equal(forged.gradedBy, "unanswered");
});

test("a missing or unknown option is unanswered, not wrong", () => {
  for (const answer of [undefined, { questionId: "q1" }, { questionId: "q1", optionId: "o9" }]) {
    const graded = gradeMultipleChoice(storedMcq, answer);
    assert.equal(graded.gradedBy, "unanswered");
    assert.equal(graded.correct, false);
    assert.equal(graded.studentAnswer, "");
  }
});

test("an unanswered short question records what was typed, if anything", () => {
  const graded = unanswered(
    { id: "q2", type: "short", question: "Why?", correctAnswer: "k", conceptTag: "c" },
    "   "
  );
  assert.equal(graded.correct, false);
  assert.equal(graded.gradedBy, "unanswered");
});

// --- Scoring --------------------------------------------------------------

const graded = (partialCredit: number): GradedAnswer => ({
  questionId: "q",
  question: "?",
  conceptTag: "c",
  studentAnswer: "a",
  correct: partialCredit === 1,
  partialCredit,
  gradedBy: "rubric",
});

test("the score counts partial credit", () => {
  assert.equal(scorePercent([graded(1), graded(1), graded(0), graded(0)]), 50);
  assert.equal(scorePercent([graded(1), graded(0.5)]), 75);
  assert.equal(scorePercent([graded(1)]), 100);
  assert.equal(scorePercent([graded(0)]), 0);
});

test("an empty attempt scores zero rather than dividing by zero", () => {
  assert.equal(scorePercent([]), 0);
});

test("out-of-range partial credit cannot inflate a score", () => {
  assert.equal(scorePercent([graded(5), graded(-3)]), 50);
});

test("the score stays within 0 and 100 for every combination", () => {
  for (let correct = 0; correct <= 6; correct++) {
    const results = [
      ...Array.from({ length: correct }, () => graded(1)),
      ...Array.from({ length: 6 - correct }, () => graded(0)),
    ];
    const score = scorePercent(results);
    assert.ok(score >= 0 && score <= 100, String(score));
  }
});
