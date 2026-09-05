import type { SpeechState } from "./speech/controller";
import type { LessonPhase } from "./lessonPlayback";

/**
 * The AI teacher's expressions, and how the lesson chooses between them.
 *
 * Kept in one table rather than several parallel ones. The avatar previously
 * held a `Record<AvatarState, Brows>` and a separate `Record<AvatarState,
 * Mouth>`, looked both up by the incoming state, and read `.lift` off the
 * result — so a state that was not in the table (an unknown value, or a prop
 * that arrived `undefined` because a stale module was still passing the old
 * props) took the whole teaching session down with it.
 *
 * Two things stop that now. Every expression is one object, so a new state
 * cannot be half-configured; and `AvatarState` is derived *from* this table's
 * keys, so the union and the configuration cannot disagree — adding a state to
 * the union is only possible by adding its expression.
 */

export interface AvatarExpression {
  /** Brow lift (negative raises) and inward tilt, in viewBox units. */
  brow: { lift: number; tilt: number };
  /** Resting mouth curve: positive smiles, negative turns down. */
  mouthCurve: number;
  /** Horizontal pupil offset; where the teacher is looking. */
  gaze: number;
  /** What the stage says the teacher is doing. */
  status: string;
}

export const AVATAR_EXPRESSIONS = {
  idle: {
    brow: { lift: 0, tilt: 0 },
    mouthCurve: 3,
    gaze: 0,
    status: "Ready",
  },
  speaking: {
    brow: { lift: -1, tilt: 0 },
    mouthCurve: 2,
    gaze: 0,
    status: "Explaining",
  },
  /** Attentive, looking towards the learner while they answer. */
  listening: {
    brow: { lift: -3, tilt: 1.5 },
    mouthCurve: 2.5,
    gaze: 1.5,
    status: "Listening",
  },
  /**
   * Considering the answer: brows raised and almost level, looking away, A steep inward tilt here reads as annoyed with
   * the student rather than thinking about what they said.
   */
  thinking: {
    brow: { lift: -2, tilt: -1 },
    mouthCurve: -1,
    gaze: -2.5,
    status: "Thinking",
  },
  /** Encouraging, not a celebration. */
  correct: {
    brow: { lift: -4, tilt: 0 },
    mouthCurve: 8,
    gaze: 0,
    status: "Well done",
  },
  /**
   * Concerned. The lesson is about to help, not to judge, so
   * this must not read as disappointment.
   */
  wrong: {
    brow: { lift: 1, tilt: 1.5 },
    mouthCurve: -3,
    gaze: 0,
    status: "Let's look again",
  },
} as const satisfies Record<string, AvatarExpression>;

export type AvatarState = keyof typeof AVATAR_EXPRESSIONS;

/** What an unrecognised state falls back to. A teacher at rest. */
export const FALLBACK_AVATAR_STATE: AvatarState = "idle";

export const AVATAR_STATES = Object.keys(AVATAR_EXPRESSIONS) as AvatarState[];

/**
 * The expression for a state, for anything at all.
 *
 * Total by construction rather than by a try/catch around the render: a visual
 * detail must never be able to fail the lesson it decorates, so an unknown,
 * missing or malformed state resolves to the resting face and the session
 * carries on.
 */
export function expressionFor(state: unknown): AvatarExpression {
  if (typeof state === "string" && Object.hasOwn(AVATAR_EXPRESSIONS, state)) {
    return AVATAR_EXPRESSIONS[state as AvatarState];
  }
  return AVATAR_EXPRESSIONS[FALLBACK_AVATAR_STATE];
}

/**
 * What the teacher is doing, from what the lesson is doing.
 *
 * Derived rather than stored: each of these is already a fact about the
 * lesson, and a second copy would be a second thing that can fall out of step.
 * Ordered by precedence — speaking wins over everything, because that is what
 * the learner can see and hear happening.
 */
export function avatarStateFor(input: {
  speechState: SpeechState;
  phase: LessonPhase;
  /** The verdict on the answer just given, when there is one. */
  answeredCorrectly?: boolean | null;
}): AvatarState {
  if (input.speechState === "speaking") return "speaking";
  if (input.phase === "evaluating") return "thinking";
  if (input.phase === "checkpoint") return "listening";
  if (input.phase === "remediation") return "wrong";
  if (input.answeredCorrectly === true) return "correct";
  return "idle";
}
