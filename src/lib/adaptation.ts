import type { CheckpointResult } from "./lessonState";
import type { LearnerProfile } from "./types";

/**
 * How the teacher adjusts to how the lesson is actually going.
 *
 * Evaluation already produced good remediation — a named misconception, a
 * re-explanation, an analogy — but it produced the same *kind* of response
 * whether the learner had just got three in a row right or three in a row
 * wrong. A teacher does not do that.
 *
 * This is deliberately a small, legible policy rather than anything that
 * learns: a short window of recent checkpoint outcomes, a run of two in the
 * same direction to shift stance, and a stance that changes how the next
 * response is delivered. It reads from the checkpoint results the server
 * already records, so it cannot be influenced by the browser, and it is a pure
 * function so the whole policy is testable.
 *
 * What it deliberately does *not* do is move the learner off the level they
 * chose. "Stretch" extends within their level; it does not promote them to the
 * next one. A learner who said "beginner" gets a harder beginner lesson, not
 * an intermediate one.
 */

export type TeachingStance = "support" | "steady" | "stretch";

export interface Adaptation {
  stance: TeachingStance;
  /** Consecutive same-direction outcomes at the end of the lesson so far. */
  streak: number;
  /** Shown to the learner, so the adaptation is visible rather than implied. */
  note: string;
  /** Appended to the evaluation prompt. */
  instruction: string;
}

/** How many checkpoints back the policy looks. */
export const ADAPTATION_WINDOW = 4;
/** A run this long in one direction shifts the stance. */
export const STREAK_TO_SHIFT = 2;

/** The run of identical outcomes ending the window, as a signed count. */
function trailingStreak(results: readonly CheckpointResult[]): {
  correct: boolean;
  length: number;
} {
  const window = results.slice(-ADAPTATION_WINDOW);
  const last = window[window.length - 1];
  if (!last) return { correct: true, length: 0 };
  let length = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].correct !== last.correct) break;
    length += 1;
  }
  return { correct: last.correct, length };
}

export function adaptationFor(
  results: readonly CheckpointResult[],
  profile: Pick<LearnerProfile, "level">
): Adaptation {
  const { correct, length } = trailingStreak(results);
  const level = profile.level;

  if (length >= STREAK_TO_SHIFT && correct) {
    return {
      stance: "stretch",
      streak: length,
      note: `${length} correct in a row — raising the challenge.`,
      instruction: `The student has answered ${length} checkpoints correctly in a row. They have this. Keep the feedback brief, skip the re-explanation they do not need, and end with one short question that extends the idea — an edge case, a "what if", or an application. Stay at the ${level} level they chose: make it a harder ${level} question, not an advanced one.`,
    };
  }

  if (length >= STREAK_TO_SHIFT && !correct) {
    return {
      stance: "support",
      streak: length,
      note: `${length} missed in a row — slowing down and simplifying.`,
      instruction: `The student has now missed ${length} checkpoints in a row, so the current explanation is not landing. Do not repeat it. Break the idea into its smallest step, use plain concrete language, and ground it in one everyday example with real numbers. Assume less prior knowledge than the ${level} level would normally imply, and be warm about it — name what they *did* get right first.`,
    };
  }

  return {
    stance: "steady",
    streak: length,
    note: "Teaching at your chosen pace.",
    instruction: `Teach at the ${level} level the student chose. Where the answer is wrong, name the misconception and re-explain it a different way than the section did.`,
  };
}

/** The label and icon a stance is shown under. */
export const STANCE_PRESENTATION: Record<
  TeachingStance,
  { label: string; icon: string }
> = {
  support: { label: "Simplifying", icon: "support" },
  steady: { label: "On track", icon: "trending_flat" },
  stretch: { label: "Raising the challenge", icon: "trending_up" },
};
