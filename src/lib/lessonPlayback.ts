import type { LessonSection } from "./types";
import type { SpeechState } from "./speech/controller";

/**
 * What the lesson's play/pause button does, as a decision separate from the
 * component that renders it.
 *
 * Pure so the button's contract can be asserted directly: the branch that
 * matters is "idle, with a section to read" — it used to do nothing at all,
 * leaving a control that looked enabled and was inert.
 */

export type LessonPhase = "narrating" | "checkpoint" | "evaluating" | "remediation" | "done";

export type PlayCommand =
  | { kind: "pause" }
  | { kind: "resume" }
  /**
   * Re-run the section's narration through the effect that owns it.
   *
   * While the lesson is narrating, the narration's completion is what advances
   * it. Speaking the same text directly from the button instead started a
   * *second* utterance that nothing was waiting on: it superseded the one the
   * lesson was awaiting, which then resolved "cancelled" and was deliberately
   * ignored, so the section could never finish. The symptom was a lesson
   * showing Pause with a question already in the transcript, an input reading
   * "Waiting for the next question…", and no way forward.
   */
  | { kind: "replay" }
  /** Re-read what the lesson is parked on. Nothing is waiting on this one. */
  | { kind: "speak"; text: string }
  /** Nothing to do, named so a dead button is diagnosable rather than a mystery. */
  | { kind: "none"; reason: "no-section" | "no-text" | "finished" };

export function playCommand(input: {
  state: SpeechState;
  phase: LessonPhase;
  section: LessonSection | undefined;
}): PlayCommand {
  if (input.state === "speaking") return { kind: "pause" };
  if (input.state === "paused") return { kind: "resume" };
  if (!input.section) return { kind: "none", reason: "no-section" };
  if (input.phase === "done") return { kind: "none", reason: "finished" };

  const text = narrationText(input.section, input.phase);
  if (!text) return { kind: "none", reason: "no-text" };
  // Narrating is the one phase whose progression depends on the utterance
  // finishing, so it is the one phase that must not be spoken from here.
  return input.phase === "narrating" ? { kind: "replay" } : { kind: "speak", text };
}

// --- the lesson's own transcript bubbles ----------------------------------

export interface TranscriptEntry {
  id: string;
  role: "ai" | "user";
  text: string;
}

export const narrationMessageId = (index: number) => `narration-${index}`;
export const questionMessageId = (index: number) => `question-${index}`;

function upsert(
  messages: readonly TranscriptEntry[],
  id: string,
  text: string
): TranscriptEntry[] {
  const at = messages.findIndex((m) => m.id === id);
  if (at === -1) return [...messages, { id, role: "ai", text }];
  if (messages[at].text === text) return [...messages];
  const next = [...messages];
  next[at] = { ...next[at], text };
  return next;
}

/**
 * The transcript as a section begins, or begins again.
 *
 * The section's question is removed as well as its narration written, because
 * the section is being taught rather than asked. Leaving the question behind
 * on a replay — which is what a language switch and the play button both do —
 * is what produced a transcript showing a question above an input reading
 * "Waiting for the next question…".
 */
export function beginSection(
  messages: readonly TranscriptEntry[],
  index: number,
  narration: string
): TranscriptEntry[] {
  const question = questionMessageId(index);
  return upsert(messages, narrationMessageId(index), narration).filter((m) => m.id !== question);
}

/** The transcript once the section's checkpoint has been reached. */
export function reachCheckpoint(
  messages: readonly TranscriptEntry[],
  index: number,
  question: string
): TranscriptEntry[] {
  return upsert(messages, questionMessageId(index), question);
}

/**
 * Rewrites the lesson's own transcript bubbles in the language the sections
 * are now written in.
 *
 * Only what the plan can regenerate — a section's narration and its checkpoint
 * question — and only where a bubble already exists, so a switch cannot
 * announce a section that has not been taught yet. The learner's answers stay
 * in the learner's words, and the teacher's in-the-moment feedback stays as it
 * was said; both are a record of the lesson rather than part of it.
 */
export function retranslateTranscript(
  messages: readonly TranscriptEntry[],
  sections: readonly LessonSection[]
): TranscriptEntry[] {
  return messages.map((message) => {
    const narration = /^narration-(\d+)$/.exec(message.id);
    if (narration) {
      const section = sections[Number(narration[1])];
      return section ? { ...message, text: narrationBody(section) } : message;
    }
    const question = /^question-(\d+)$/.exec(message.id);
    if (question) {
      const asked = sections[Number(question[1])]?.checkpoint?.question;
      return asked ? { ...message, text: asked } : message;
    }
    return message;
  });
}

/** How a section reads in the transcript: the teaching, then its example. */
export function narrationBody(section: LessonSection): string {
  return section.narration + (section.example ? `\n\nExample: ${section.example}` : "");
}

/**
 * The text the lesson is reading aloud right now — the question once the
 * section has reached its checkpoint, the teaching before that.
 */
export function narrationText(section: LessonSection, phase: LessonPhase): string {
  if (phase === "checkpoint" || phase === "evaluating") return section.checkpoint?.question ?? "";
  return [section.narration, section.example ? `For example: ${section.example}` : ""]
    .filter(Boolean)
    .join(" ");
}
