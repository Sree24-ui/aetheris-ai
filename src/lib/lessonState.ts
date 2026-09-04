import type { LearnerProfile, LessonPlan, LessonSection, TranscriptMessage } from "./types";

/**
 * The lesson state machine, as a pure function.
 *
 * The lesson used to live only in browser state: a refresh lost it, another
 * device could not see it, and every transition was an implicit consequence of
 * a React state update rather than a command anyone could name. This file has
 * the transitions and the rules about which are legal; `lessonSessionStore.ts`
 * persists the result. Keeping them apart is what makes the interesting
 * cases — a duplicate completion, a command from a stale tab, an answer
 * submitted after the lesson was cancelled — testable without a database.
 */

/** Bumped when the teaching prompts change, so a stored plan stays traceable. */
export const PROMPT_VERSION = "teaching/1.0.0";

export type LessonStatus = "active" | "paused" | "completed" | "cancelled";

export interface CheckpointResult {
  sectionId: string;
  conceptTag: string;
  correct: boolean;
  /** Kept as evidence for the report and for a disputed grade. */
  studentAnswer: string;
}

/** A passage that grounded the lesson, so a claim can be traced to it. */
export interface LessonSource {
  chunkId: string;
  source: string | null;
  score: number;
}

export interface LessonSessionState {
  id: string;
  status: LessonStatus;
  topic: string;
  language: string;
  /** The configuration the lesson was planned for, so a resume can restore it. */
  profile: LearnerProfile;
  /** The full plan, answer keys included. Never sent to a client. */
  plan: LessonPlan;
  pathTopic: string | null;
  pathStepIndex: number | null;
  currentSectionIndex: number;
  checkpointResults: CheckpointResult[];
  transcript: TranscriptMessage[];
  quizId: string | null;
  /** The retrieved passages this lesson was built from, for traceability. */
  sources: LessonSource[];
  /** Optimistic-concurrency token; every accepted command increments it. */
  version: number;
}

export type LessonCommand =
  | { type: "advance"; toSectionIndex: number; transcript?: TranscriptMessage[] }
  | { type: "checkpoint"; result: CheckpointResult }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" }
  | { type: "complete"; quizId: string };

export type CommandResult =
  | { ok: true; state: LessonSessionState; changed: boolean }
  | { ok: false; reason: CommandRejection; state: LessonSessionState };

export type CommandRejection =
  | "stale-version"
  | "not-active"
  | "already-finished"
  | "invalid-section"
  | "unknown-section";

/** How much transcript one session may carry, to bound the stored row. */
export const MAX_TRANSCRIPT_ENTRIES = 400;

/** A lesson that is still the learner's to work on. */
export function isLive(status: LessonStatus): boolean {
  return status === "active" || status === "paused";
}

/**
 * Applies one command.
 *
 * `expectedVersion` is what the caller believed the session was on. A command
 * carrying a stale version is refused rather than applied, which is what makes
 * a duplicate or out-of-order request from a background tab harmless: the
 * caller gets the real state back and can reconcile.
 *
 * The one deliberate exception is a command that asks for something already
 * true — completing a completed lesson, pausing a paused one. Those report
 * success with `changed: false`, because a retry after a dropped response must
 * not look like a failure.
 */
export function applyCommand(
  state: LessonSessionState,
  command: LessonCommand,
  expectedVersion: number
): CommandResult {
  // Idempotent replays are recognised before the version check: a retry of a
  // command that already took effect carries the version from before it, and
  // refusing it would make a lost response look like an error.
  if (command.type === "complete" && state.status === "completed") {
    return { ok: true, state, changed: false };
  }
  if (command.type === "cancel" && state.status === "cancelled") {
    return { ok: true, state, changed: false };
  }
  if (command.type === "pause" && state.status === "paused") {
    return { ok: true, state, changed: false };
  }
  if (command.type === "resume" && state.status === "active") {
    return { ok: true, state, changed: false };
  }

  if (!isLive(state.status)) {
    return { ok: false, reason: "already-finished", state };
  }
  if (expectedVersion !== state.version) {
    return { ok: false, reason: "stale-version", state };
  }

  const next = (patch: Partial<LessonSessionState>): CommandResult => ({
    ok: true,
    state: { ...state, ...patch, version: state.version + 1 },
    changed: true,
  });

  switch (command.type) {
    case "advance": {
      const sectionCount = state.plan.sections.length;
      // Only forward, only by real sections. A negative or past-the-end index
      // would leave the lesson pointing at a section that does not exist.
      if (
        !Number.isInteger(command.toSectionIndex) ||
        command.toSectionIndex < 0 ||
        command.toSectionIndex >= sectionCount ||
        command.toSectionIndex < state.currentSectionIndex
      ) {
        return { ok: false, reason: "invalid-section", state };
      }
      if (state.status !== "active") return { ok: false, reason: "not-active", state };
      return next({
        currentSectionIndex: command.toSectionIndex,
        transcript: command.transcript
          ? command.transcript.slice(-MAX_TRANSCRIPT_ENTRIES)
          : state.transcript,
      });
    }

    case "checkpoint": {
      if (state.status !== "active") return { ok: false, reason: "not-active", state };
      const known = state.plan.sections.some((s) => s.id === command.result.sectionId);
      if (!known) return { ok: false, reason: "unknown-section", state };
      // One result per section: re-answering replaces rather than appends, so
      // a retried submission cannot double-count a concept in the report.
      const others = state.checkpointResults.filter(
        (r) => r.sectionId !== command.result.sectionId
      );
      return next({ checkpointResults: [...others, command.result] });
    }

    case "pause":
      return next({ status: "paused" });

    case "resume":
      return next({ status: "active" });

    case "cancel":
      return next({ status: "cancelled" });

    case "complete":
      return next({ status: "completed", quizId: command.quizId });
  }
}

/** A checkpoint with its answer removed. */
type LearnerCheckpoint = Omit<NonNullable<LessonSection["checkpoint"]>, "correctAnswer">;

export interface LearnerSection extends Omit<LessonSection, "checkpoint"> {
  checkpoint?: LearnerCheckpoint | null;
}

export interface LearnerPlan extends Omit<LessonPlan, "sections"> {
  sections: LearnerSection[];
}

/**
 * The plan as the browser is allowed to see it.
 *
 * H10: checkpoint answers used to travel inside the lesson plan, so the key to
 * every mid-lesson question was in the page before it was asked. They are
 * removed here — absent, not blanked — and grading happens on the server
 * against the stored plan.
 */
export function toLearnerPlan(plan: LessonPlan): LearnerPlan {
  return {
    ...plan,
    sections: plan.sections.map((section) => {
      if (!section.checkpoint) return { ...section, checkpoint: null };
      // Rebuilt field by field rather than by destructuring the key away, so
      // adding a field to CheckpointQuestion cannot silently start leaking it.
      const { id, type, question, options, conceptTag } = section.checkpoint;
      return { ...section, checkpoint: { id, type, question, options, conceptTag } };
    }),
  };
}
