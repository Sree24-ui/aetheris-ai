import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTATION_WINDOW, STANCE_PRESENTATION, adaptationFor } from "./adaptation";
import type { CheckpointResult } from "./lessonState";

/**
 * The teacher used to respond identically whether the student had just got
 * three right or three wrong. These pin the policy that changed that, and the
 * two rules that keep it safe: it never moves the learner off the level they
 * chose, and it never shifts on a single answer.
 */

const beginner = { level: "beginner" as const };
const result = (correct: boolean, sectionId = `s${Math.random()}`): CheckpointResult => ({
  sectionId,
  conceptTag: "gradient",
  correct,
  studentAnswer: correct ? "rise over run" : "run over rise",
});

const right = () => result(true);
const wrong = () => result(false);

test("a lesson with no checkpoints yet teaches at the chosen level", () => {
  const adaptation = adaptationFor([], beginner);
  assert.equal(adaptation.stance, "steady");
  assert.equal(adaptation.streak, 0);
  assert.ok(adaptation.instruction.includes("beginner"));
});

test("one right answer is not enough to raise the challenge", () => {
  // A single lucky answer is not evidence. Shifting on it would make the
  // lesson lurch about, which is the opposite of adapting.
  assert.equal(adaptationFor([right()], beginner).stance, "steady");
});

test("one wrong answer is not enough to start simplifying", () => {
  assert.equal(adaptationFor([wrong()], beginner).stance, "steady");
});

test("two right in a row raises the challenge", () => {
  const adaptation = adaptationFor([right(), right()], beginner);
  assert.equal(adaptation.stance, "stretch");
  assert.equal(adaptation.streak, 2);
  assert.ok(/extends|edge case|what if|application/i.test(adaptation.instruction));
});

test("two wrong in a row simplifies instead of repeating itself", () => {
  const adaptation = adaptationFor([wrong(), wrong()], beginner);
  assert.equal(adaptation.stance, "support");
  assert.equal(adaptation.streak, 2);
  assert.ok(
    /do not repeat/i.test(adaptation.instruction),
    "re-explaining the same way is what failed the first time"
  );
});

test("stretching stays inside the level the learner chose", () => {
  // Adaptation changes delivery, not the learner's declared level: a beginner
  // who is doing well gets a harder beginner lesson, not an advanced one.
  for (const level of ["beginner", "intermediate", "advanced"] as const) {
    const adaptation = adaptationFor([right(), right(), right()], { level });
    assert.equal(adaptation.stance, "stretch");
    assert.ok(adaptation.instruction.includes(level), `stance must name ${level}`);
  }
});

test("supporting says what the learner should be assumed to know", () => {
  const adaptation = adaptationFor([wrong(), wrong()], { level: "advanced" });
  assert.ok(adaptation.instruction.includes("advanced"));
  assert.ok(/less prior knowledge/i.test(adaptation.instruction));
});

test("a recovered answer ends the run that was simplifying", () => {
  // Getting one right after two wrong returns the lesson to its normal pace
  // rather than leaving it simplified for the rest of the session.
  const adaptation = adaptationFor([wrong(), wrong(), right()], beginner);
  assert.equal(adaptation.stance, "steady");
  assert.equal(adaptation.streak, 1);
});

test("a slip ends the run that was stretching", () => {
  const adaptation = adaptationFor([right(), right(), wrong()], beginner);
  assert.equal(adaptation.stance, "steady");
});

test("only the recent window counts, not the whole lesson", () => {
  // Six right answers half an hour ago must not keep a struggling learner on
  // the stretch track.
  const long = [...Array(6)].map(right).concat([wrong(), wrong()]);
  assert.equal(adaptationFor(long, beginner).stance, "support");
});

test("a long correct run is capped by the window rather than growing forever", () => {
  const many = [...Array(12)].map(right);
  const adaptation = adaptationFor(many, beginner);
  assert.equal(adaptation.stance, "stretch");
  assert.equal(adaptation.streak, ADAPTATION_WINDOW);
});

test("every stance has something the learner can be shown", () => {
  // The adaptation is displayed, not just applied: a lesson that silently
  // changes register looks inconsistent rather than responsive.
  for (const results of [[], [right(), right()], [wrong(), wrong()]]) {
    const adaptation = adaptationFor(results, beginner);
    assert.ok(adaptation.note.length > 0);
    assert.ok(STANCE_PRESENTATION[adaptation.stance].label.length > 0);
    assert.ok(STANCE_PRESENTATION[adaptation.stance].icon.length > 0);
  }
});

test("the note names the run, so the learner can see why", () => {
  assert.ok(adaptationFor([right(), right()], beginner).note.includes("2"));
  assert.ok(adaptationFor([wrong(), wrong(), wrong()], beginner).note.includes("3"));
});
