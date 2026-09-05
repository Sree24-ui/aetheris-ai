import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  toLearnerPlan,
  type LessonSessionState,
  lessonIdentity,
} from "./lessonState";
import type { LessonPlan } from "./types";

/**
 * Regression tests for the lesson state machine.
 *
 * The lesson used to live in browser state, where every transition was an
 * implicit consequence of a React update. These pin the rules that make a
 * refresh, a duplicate request or a stale background tab harmless.
 */

const section = (id: string, withCheckpoint = false): LessonPlan["sections"][number] => ({
  id,
  title: `Section ${id}`,
  narration: "Narration.",
  bulletPoints: [],
  visual: { type: "none" },
  estimatedSeconds: 60,
  conceptTags: ["c"],
  checkpoint: withCheckpoint
    ? {
        id: `${id}-cp`,
        type: "short",
        question: "Why?",
        correctAnswer: "Because of the axiom.",
        conceptTag: "reasons",
      }
    : null,
});

const plan: LessonPlan = {
  topic: "Algebra",
  subject: "mathematics",
  levelSummary: "",
  totalEstimatedMinutes: 20,
  language: "English",
  sections: [section("s1", true), section("s2"), section("s3")],
  finalQuizTopics: [],
  sourceGrounded: false,
};

const base = (overrides: Partial<LessonSessionState> = {}): LessonSessionState => ({
  id: "session-1",
  status: "active",
  topic: "Algebra",
  language: "English",
  profile: { level: "beginner", language: "English", availableMinutes: 20 },
  plan,
  pathTopic: null,
  pathStepIndex: null,
  currentSectionIndex: 0,
  checkpointResults: [],
  transcript: [],
  quizId: null,
  sources: [],
  version: 3,
  ...overrides,
});

// --- The answer key ------------------------------------------------------

test("the learner's plan carries no checkpoint answers", () => {
  const learner = toLearnerPlan(plan);
  const serialised = JSON.stringify(learner);
  assert.ok(!serialised.includes("correctAnswer"), serialised);
  assert.ok(!serialised.includes("Because of the axiom"), serialised);
  // Everything needed to ask the question is still there.
  assert.equal(learner.sections[0].checkpoint?.question, "Why?");
  assert.equal(learner.sections[0].checkpoint?.conceptTag, "reasons");
});

test("sections without a checkpoint are unaffected", () => {
  const learner = toLearnerPlan(plan);
  assert.equal(learner.sections[1].checkpoint, null);
  assert.equal(learner.sections.length, 3);
});

// --- Version checks ------------------------------------------------------

test("a command carrying a stale version is refused", () => {
  const state = base();
  const result = applyCommand(state, { type: "advance", toSectionIndex: 1 }, 2);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "stale-version");
});

test("an accepted command moves the version on", () => {
  const result = applyCommand(base(), { type: "advance", toSectionIndex: 1 }, 3);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.version, 4);
    assert.equal(result.state.currentSectionIndex, 1);
  }
});

test("a replayed advance cannot skip a section", () => {
  // Two tabs, both on version 3, both advancing. The second is refused
  // rather than moving the lesson two sections on.
  const state = base();
  const first = applyCommand(state, { type: "advance", toSectionIndex: 1 }, 3);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = applyCommand(first.state, { type: "advance", toSectionIndex: 1 }, 3);
  assert.equal(second.ok, false);
  assert.equal(first.state.currentSectionIndex, 1);
});

// --- Section bounds ------------------------------------------------------

test("the section index cannot leave the plan", () => {
  for (const toSectionIndex of [-1, 3, 99, 1.5]) {
    const result = applyCommand(base(), { type: "advance", toSectionIndex }, 3);
    assert.equal(result.ok, false, String(toSectionIndex));
    if (!result.ok) assert.equal(result.reason, "invalid-section");
  }
});

test("a lesson cannot be rewound by a late request", () => {
  const state = base({ currentSectionIndex: 2 });
  const result = applyCommand(state, { type: "advance", toSectionIndex: 1 }, 3);
  assert.equal(result.ok, false);
});

test("the transcript is bounded", () => {
  const huge = Array.from({ length: 900 }, (_, i) => ({ role: "ai" as const, text: `m${i}` }));
  const result = applyCommand(base(), { type: "advance", toSectionIndex: 1, transcript: huge }, 3);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.state.transcript.length, 400);
});

// --- Checkpoints ---------------------------------------------------------

const checkpointResult = (correct: boolean) => ({
  sectionId: "s1",
  conceptTag: "reasons",
  correct,
  studentAnswer: "an answer",
});

test("a checkpoint result is recorded against its section", () => {
  const result = applyCommand(base(), { type: "checkpoint", result: checkpointResult(true) }, 3);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.state.checkpointResults, [checkpointResult(true)]);
});

test("re-answering replaces rather than double-counting", () => {
  const first = applyCommand(base(), { type: "checkpoint", result: checkpointResult(false) }, 3);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = applyCommand(
    first.state,
    { type: "checkpoint", result: checkpointResult(true) },
    4
  );
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.state.checkpointResults.length, 1);
    assert.equal(second.state.checkpointResults[0].correct, true);
  }
});

test("a checkpoint for a section not in the plan is refused", () => {
  const result = applyCommand(
    base(),
    { type: "checkpoint", result: { ...checkpointResult(true), sectionId: "nope" } },
    3
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "unknown-section");
});

// --- Lifecycle -----------------------------------------------------------

test("pause and resume move between active and paused", () => {
  const paused = applyCommand(base(), { type: "pause" }, 3);
  assert.equal(paused.ok, true);
  if (!paused.ok) return;
  assert.equal(paused.state.status, "paused");

  const resumed = applyCommand(paused.state, { type: "resume" }, 4);
  assert.equal(resumed.ok, true);
  if (resumed.ok) assert.equal(resumed.state.status, "active");
});

test("a paused lesson does not advance or grade", () => {
  const state = base({ status: "paused" });
  assert.equal(applyCommand(state, { type: "advance", toSectionIndex: 1 }, 3).ok, false);
  assert.equal(
    applyCommand(state, { type: "checkpoint", result: checkpointResult(true) }, 3).ok,
    false
  );
});

test("completing twice is a no-op, not an error", () => {
  const done = applyCommand(base(), { type: "complete", quizId: "quiz-1" }, 3);
  assert.equal(done.ok, true);
  if (!done.ok) return;
  assert.equal(done.state.status, "completed");
  assert.equal(done.state.quizId, "quiz-1");

  // A retry after a dropped response carries the old version. It must not
  // look like a failure, and it must not change anything.
  const replay = applyCommand(done.state, { type: "complete", quizId: "quiz-1" }, 3);
  assert.equal(replay.ok, true);
  if (replay.ok) {
    assert.equal(replay.changed, false);
    assert.equal(replay.state.version, done.state.version);
  }
});

test("cancelling twice is likewise a no-op", () => {
  const cancelled = applyCommand(base(), { type: "cancel" }, 3);
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) return;
  const replay = applyCommand(cancelled.state, { type: "cancel" }, 1);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.changed, false);
});

test("a finished lesson accepts nothing further", () => {
  for (const status of ["completed", "cancelled"] as const) {
    const state = base({ status });
    for (const command of [
      { type: "advance" as const, toSectionIndex: 1 },
      { type: "checkpoint" as const, result: checkpointResult(true) },
      { type: "pause" as const },
      { type: "resume" as const },
    ]) {
      const result = applyCommand(state, command, 3);
      assert.equal(result.ok, false, `${status} accepted ${command.type}`);
      if (!result.ok) assert.equal(result.reason, "already-finished");
    }
  }
});

test("a rejected command never mutates the state it was given", () => {
  const state = base();
  const snapshot = JSON.stringify(state);
  applyCommand(state, { type: "advance", toSectionIndex: 99 }, 3);
  applyCommand(state, { type: "advance", toSectionIndex: 1 }, 1);
  assert.equal(JSON.stringify(state), snapshot);
});

// --- what a finished lesson is recorded under -----------------------------

/**
 * Completion wrote a history row with `topic = ""` and `language = ""`, and
 * PostgreSQL refused it: `learner_history_topic_not_blank`. The values had not
 * been lost — the route that built the row had no source for them once the
 * plan stopped being posted back, and filled in blanks. They live on the
 * session, which is what these pin.
 */

test("a lesson is recorded under the session's own topic and language", () => {
  assert.deepEqual(lessonIdentity(base()), {
    topic: "Algebra",
    language: "English",
    subject: "mathematics",
  });
});

test("the topic survives every command a lesson receives", () => {
  // Nothing in the transition set touches topic or language, and this is what
  // says so: create, teach, answer, complete, and it is still recordable.
  let state = base({ topic: "Formula One", language: "English" });
  const step = (command: Parameters<typeof applyCommand>[1]) => {
    const result = applyCommand(state, command, state.version);
    assert.equal(result.ok, true, `command ${command.type} was refused`);
    state = result.state;
  };

  step({ type: "advance", toSectionIndex: 1 });
  step({
    type: "checkpoint",
    result: { sectionId: "s1", conceptTag: "reasons", correct: true, studentAnswer: "Because." },
  });
  step({ type: "pause" });
  step({ type: "resume" });
  step({ type: "advance", toSectionIndex: 2 });
  step({ type: "complete", quizId: "11111111-1111-4111-8111-111111111111" });

  assert.equal(state.status, "completed");
  assert.deepEqual(lessonIdentity(state), {
    topic: "Formula One",
    language: "English",
    subject: "mathematics",
  });
});

test("blank metadata is refused rather than written as empty strings", () => {
  const blankPlan = { ...plan, topic: "", language: "" };
  assert.equal(lessonIdentity(base({ topic: "", plan: blankPlan })), null);
  assert.equal(lessonIdentity(base({ language: "", plan: blankPlan })), null);
  assert.equal(lessonIdentity(base({ topic: "   ", plan: blankPlan })), null);
});

test("whitespace is trimmed rather than passed to the constraint", () => {
  // `length(btrim(topic)) > 0` is the database's rule; matching it here is
  // what keeps the refusal a named error instead of a 23514.
  assert.equal(lessonIdentity(base({ topic: "  Formula One  " }))?.topic, "Formula One");
});

test("the plan stands in when the session's own columns are empty", () => {
  const identity = lessonIdentity(base({ topic: "", language: "" }));
  assert.equal(identity?.topic, "Algebra");
  assert.equal(identity?.language, "English");
});

test("a missing subject is null, not an empty string", () => {
  // The column is nullable; "" would be a subject the learner never chose.
  assert.equal(lessonIdentity(base({ plan: { ...plan, subject: "" } }))?.subject, null);
});
