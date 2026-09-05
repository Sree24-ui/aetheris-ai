import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginSection,
  narrationBody,
  narrationText,
  playCommand,
  reachCheckpoint,
  retranslateTranscript,
  type TranscriptEntry,
} from "./lessonPlayback";
import type { LessonSection } from "./types";

/**
 * The play/pause button did nothing on a live lesson: no `speechSynthesis`
 * activity, no state change, the icon stuck on ▶. These pin what the button
 * is supposed to decide, so a dead control is a failing test rather than a
 * browser session.
 */

const section: LessonSection = {
  id: "s1",
  title: "Gradient",
  narration: "Gradient is rise over run.",
  bulletPoints: [],
  visual: { type: "none" },
  example: "A ramp climbing 1m over 4m has a gradient of 0.25.",
  checkpoint: { id: "c1", type: "short", question: "What is rise over run?", conceptTag: "gradient" },
  estimatedSeconds: 60,
  conceptTags: [],
};

test("an idle, narrating lesson replays through the effect that owns it", () => {
  // The stall: speaking directly from the button started a second utterance
  // that nothing awaited. It superseded the one the lesson was waiting on —
  // which then resolved "cancelled" and was ignored by design — so the section
  // could never end. Play must re-run the narration, not race it.
  assert.deepEqual(playCommand({ state: "idle", phase: "narrating", section }), {
    kind: "replay",
  });
});

test("play pauses what is speaking and resumes what is paused", () => {
  assert.equal(playCommand({ state: "speaking", phase: "narrating", section }).kind, "pause");
  assert.equal(playCommand({ state: "paused", phase: "narrating", section }).kind, "resume");
});

test("pause and resume do not depend on there being a section", () => {
  // Whatever is in flight can always be stopped, even mid-teardown.
  assert.equal(playCommand({ state: "speaking", phase: "done", section: undefined }).kind, "pause");
  assert.equal(playCommand({ state: "paused", phase: "done", section: undefined }).kind, "resume");
});

test("every do-nothing outcome names its reason", () => {
  const noSection = playCommand({ state: "idle", phase: "narrating", section: undefined });
  assert.deepEqual(noSection, { kind: "none", reason: "no-section" });

  const noQuestion = playCommand({
    state: "idle",
    phase: "checkpoint",
    section: { ...section, checkpoint: undefined },
  });
  assert.deepEqual(noQuestion, { kind: "none", reason: "no-text" });
});

test("at a checkpoint, play re-reads the question rather than the teaching", () => {
  for (const phase of ["checkpoint", "evaluating"] as const) {
    const command = playCommand({ state: "idle", phase, section });
    assert.equal(command.kind === "speak" && command.text, "What is rise over run?");
  }
});

test("narration includes the worked example, and remediation re-reads the teaching", () => {
  assert.ok(narrationText(section, "narrating").includes("For example:"));
  assert.ok(narrationText(section, "remediation").includes("rise over run"));
});

test("a section with no example is read without a dangling lead-in", () => {
  const text = narrationText({ ...section, example: undefined }, "narrating");
  assert.equal(text, "Gradient is rise over run.");
  assert.ok(!text.includes("For example"));
});

// --- the stall: a question on screen with no way to answer it -------------

/**
 * The forbidden state, reported from a real lesson: the transcript showed a
 * checkpoint question, the play control showed Pause, and the answer input
 * read "Waiting for the next question…" and was disabled, forever.
 *
 * Two things produced it — a play button that started an utterance nothing
 * was waiting on, and a replay that reset the phase to "narrating" while
 * leaving the question bubble on screen. Both are pinned here.
 */

const transcript: TranscriptEntry[] = [
  { id: "narration-0", role: "ai", text: "Gradient is rise over run." },
  { id: "question-0", role: "ai", text: "What is rise over run?" },
  { id: "m1", role: "user", text: "The slope." },
];

test("a question is never left on screen once its section starts again", () => {
  // Replaying a section — the play button, and a language switch — puts the
  // lesson back into "narrating", where the answer input is disabled. The
  // question has to leave with it.
  const replayed = beginSection(transcript, 0, "Gradient is rise over run.");
  assert.equal(replayed.some((m) => m.id === "question-0"), false);
  assert.ok(replayed.some((m) => m.id === "narration-0"));
});

test("the learner's own answers survive a replay", () => {
  const replayed = beginSection(transcript, 0, "Gradient is rise over run.");
  assert.deepEqual(replayed.find((m) => m.id === "m1"), transcript[2]);
});

test("reaching the checkpoint again puts the question back, once", () => {
  const replayed = beginSection(transcript, 0, "Gradient is rise over run.");
  const asked = reachCheckpoint(replayed, 0, "What is rise over run?");
  assert.equal(asked.filter((m) => m.id === "question-0").length, 1);
  const askedAgain = reachCheckpoint(asked, 0, "What is rise over run?");
  assert.equal(askedAgain.filter((m) => m.id === "question-0").length, 1);
});

test("a section narrated a second time is rewritten, not repeated", () => {
  const first = beginSection([], 0, "Gradient is rise over run.");
  const second = beginSection(first, 0, "경사는 상승 나누기 수평 거리입니다.");
  assert.equal(second.length, 1);
  assert.equal(second[0].text, "경사는 상승 나누기 수평 거리입니다.");
});

test("beginning a later section leaves earlier ones alone", () => {
  const next = beginSection(transcript, 1, "Next section.");
  assert.ok(next.some((m) => m.id === "question-0"), "only this section's question goes");
  assert.ok(next.some((m) => m.id === "narration-1"));
});

test("the input is never disabled while its question is on screen", () => {
  // The invariant the two helpers exist to hold, checked as the pair the
  // component uses: "narrating" hides the question, "checkpoint" shows it.
  const answering = (phase: string) => phase === "checkpoint" || phase === "evaluating";
  const narrating = beginSection(transcript, 0, "Gradient is rise over run.");
  assert.equal(
    narrating.some((m) => m.id === "question-0") && !answering("narrating"),
    false,
    "a question on screen with a disabled input is the reported stall"
  );
  const asking = reachCheckpoint(narrating, 0, "What is rise over run?");
  assert.equal(asking.some((m) => m.id === "question-0") && answering("checkpoint"), true);
});

test("a checkpoint re-read is spoken directly, because nothing waits on it", () => {
  // The lesson is parked: the phase has its own way forward, so this utterance
  // is allowed to be detached in a way a narration never is.
  const command = playCommand({ state: "idle", phase: "checkpoint", section });
  assert.equal(command.kind, "speak");
  assert.equal(command.kind === "speak" && command.text, "What is rise over run?");
});

test("a finished lesson does not restart itself", () => {
  assert.deepEqual(playCommand({ state: "idle", phase: "done", section }), {
    kind: "none",
    reason: "finished",
  });
});

// --- language coverage ----------------------------------------------------

test("a language switch rewrites the lesson's own bubbles", () => {
  // The reported mix: English narration above a Korean checkpoint, because
  // bubbles already on screen were never revisited.
  const korean = [
    {
      ...section,
      narration: "경사는 상승 나누기 수평 거리입니다.",
      example: undefined,
      checkpoint: { ...section.checkpoint!, question: "상승 나누기 수평 거리는 무엇입니까?" },
    },
  ];
  const rewritten = retranslateTranscript(transcript, korean);
  assert.equal(rewritten[0].text, "경사는 상승 나누기 수평 거리입니다.");
  assert.equal(rewritten[1].text, "상승 나누기 수평 거리는 무엇입니까?");
});

test("a language switch never rewrites the learner's own words", () => {
  const rewritten = retranslateTranscript(transcript, [section]);
  assert.deepEqual(rewritten[2], transcript[2]);
});

test("a switch does not announce a section that has not been taught", () => {
  // Only bubbles that already exist are rewritten: adding one for a later
  // section would show the learner a section before the lesson reaches it.
  const rewritten = retranslateTranscript(transcript, [section, section, section]);
  assert.equal(rewritten.length, transcript.length);
  assert.equal(rewritten.some((m) => m.id === "narration-1"), false);
});

test("a section that failed to translate keeps its bubble rather than blanking it", () => {
  const rewritten = retranslateTranscript(transcript, []);
  assert.deepEqual(rewritten, transcript);
});

test("a question bubble for a section that lost its checkpoint is left as it was", () => {
  const rewritten = retranslateTranscript(transcript, [{ ...section, checkpoint: undefined }]);
  assert.equal(rewritten[1].text, "What is rise over run?");
});

test("the transcript body matches what the narration effect writes", () => {
  // Both halves have to agree, or a switch would rewrite a bubble into a
  // different shape than the one the lesson wrote.
  assert.equal(narrationBody(section), `${section.narration}\n\nExample: ${section.example}`);
  assert.equal(narrationBody({ ...section, example: undefined }), section.narration);
});
