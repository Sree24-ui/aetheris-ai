import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_EXPRESSIONS,
  AVATAR_STATES,
  FALLBACK_AVATAR_STATE,
  avatarStateFor,
  expressionFor,
} from "./avatarState";
import type { LessonPhase } from "./lessonPlayback";
import type { SpeechState } from "./speech/controller";

/**
 * The avatar took the whole teaching session down with
 * `TypeError: Cannot read properties of undefined (reading 'lift')`: two
 * parallel lookup tables, keyed by a state that could arrive as something not
 * in them, whose result was then read from without a check.
 *
 * A visual detail must never be able to fail the lesson it decorates.
 */

test("every state the avatar can be in has a complete expression", () => {
  assert.ok(AVATAR_STATES.length >= 6);
  for (const state of AVATAR_STATES) {
    const expression = expressionFor(state);
    assert.equal(typeof expression.brow.lift, "number", `${state}.brow.lift`);
    assert.equal(typeof expression.brow.tilt, "number", `${state}.brow.tilt`);
    assert.equal(typeof expression.mouthCurve, "number", `${state}.mouthCurve`);
    assert.equal(typeof expression.gaze, "number", `${state}.gaze`);
  }
});

test("the canonical states are all still present", () => {
  // Renaming or dropping one is a UI decision, not something to discover from
  // a blank face mid-demo.
  for (const state of ["idle", "speaking", "listening", "thinking", "correct", "wrong"]) {
    assert.ok(AVATAR_STATES.includes(state as never), `missing state: ${state}`);
  }
});

test("anything unrecognised resolves to the resting face instead of throwing", () => {
  // The exact shape of the crash: a state that is not in the table.
  const rubbish: unknown[] = [
    undefined,
    null,
    "",
    "SPEAKING",
    "confused",
    0,
    42,
    {},
    [],
    Symbol("speaking"),
    NaN,
    () => "idle",
  ];
  for (const value of rubbish) {
    const expression = expressionFor(value);
    assert.deepEqual(
      expression,
      AVATAR_EXPRESSIONS[FALLBACK_AVATAR_STATE],
      `${String(value)} must fall back, not crash`
    );
    assert.equal(typeof expression.brow.lift, "number");
  }
});

test("inherited object properties are not mistaken for states", () => {
  // `"toString" in AVATAR_EXPRESSIONS` is true up the prototype chain, and
  // would have returned a function where an expression belongs.
  for (const inherited of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
    assert.deepEqual(expressionFor(inherited), AVATAR_EXPRESSIONS[FALLBACK_AVATAR_STATE]);
  }
});

test("the fallback is itself a real state", () => {
  assert.ok(AVATAR_STATES.includes(FALLBACK_AVATAR_STATE));
});

// --- what the lesson asks the avatar to do -------------------------------

const state = (
  speechState: SpeechState,
  phase: LessonPhase,
  answeredCorrectly: boolean | null = null
) => avatarStateFor({ speechState, phase, answeredCorrectly });

test("speaking wins over every other signal", () => {
  // It is the one thing the learner can see and hear happening.
  for (const phase of ["narrating", "checkpoint", "evaluating", "remediation", "done"] as const) {
    assert.equal(state("speaking", phase), "speaking", phase);
  }
});

test("the teacher listens while the learner answers and thinks while grading", () => {
  assert.equal(state("idle", "checkpoint"), "listening");
  assert.equal(state("idle", "evaluating"), "thinking");
});

test("remediation shows concern whatever the previous verdict was", () => {
  assert.equal(state("idle", "remediation"), "wrong");
  assert.equal(state("idle", "remediation", false), "wrong");
  assert.equal(state("idle", "remediation", true), "wrong");
});

test("a correct answer is acknowledged, and only a correct one", () => {
  assert.equal(state("idle", "narrating", true), "correct");
  assert.equal(state("idle", "narrating", false), "idle");
  assert.equal(state("idle", "narrating", null), "idle");
});

test("a paused lesson rests rather than miming speech", () => {
  assert.equal(state("paused", "narrating"), "idle");
});

test("every derived state is one the avatar can actually render", () => {
  // The two halves cannot drift: whatever the lesson derives has to be in the
  // expression table, or the crash comes back.
  for (const speech of ["idle", "speaking", "paused"] as const) {
    for (const phase of ["narrating", "checkpoint", "evaluating", "remediation", "done"] as const) {
      for (const answered of [true, false, null]) {
        const derived = state(speech, phase, answered);
        assert.ok(AVATAR_STATES.includes(derived), `${speech}/${phase} → ${derived}`);
        assert.deepEqual(expressionFor(derived), AVATAR_EXPRESSIONS[derived]);
      }
    }
  }
});
