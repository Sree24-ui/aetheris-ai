import type { EngineHandlers, SpeechEngine, SpeechRequest } from "./controller";

/**
 * Narration for a device that has no voice for the lesson's language.
 *
 * The app offers 22 teaching languages; speech voices come from the operating
 * system, and a typical macOS install has none for Marathi, Gujarati,
 * Malayalam, Punjabi or Urdu. Handing the text to `speechSynthesis` anyway
 * produced an utterance that fired neither `onstart` nor `onend`, so the
 * lesson sat waiting on narration that would never finish: the section never
 * advanced, the play button re-armed the same dead utterance rather than
 * resuming, and only the watchdog eventually released it.
 *
 * This engine runs the same lifecycle on a timer instead. It starts, it ends
 * after the time the text takes to read, and it pauses and resumes — so the
 * controller above it, the lesson's timeline, the play/pause button and
 * completion all behave exactly as they do with a voice. The learner loses
 * narration, which is the one thing the device genuinely cannot do, and
 * nothing else.
 */

export interface Timers {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

const REAL_TIMERS: Timers = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createSilentEngine(timers: Timers = REAL_TIMERS): SpeechEngine {
  let handle: unknown = null;
  let handlers: EngineHandlers | null = null;
  /** Reading time still owed, recomputed on pause. */
  let remainingMs = 0;
  /** When the current window started, so a pause can subtract from it. */
  let startedAt = 0;

  function arm(ms: number): void {
    remainingMs = ms;
    startedAt = timers.now();
    handle = timers.setTimer(() => {
      handle = null;
      const finished = handlers;
      handlers = null;
      finished?.onEnd();
    }, ms);
  }

  return {
    start(request: SpeechRequest, next: EngineHandlers) {
      handlers = next;
      // Synchronous, like a real engine's `onstart`, so the controller leaves
      // "idle" immediately and the play button offers pause rather than play.
      next.onStart();
      arm(Math.max(0, request.silentMs ?? 0));
    },
    cancel() {
      if (handle !== null) timers.clearTimer(handle);
      handle = null;
      handlers = null;
    },
    pause() {
      if (handle === null) return;
      timers.clearTimer(handle);
      handle = null;
      remainingMs = Math.max(0, remainingMs - (timers.now() - startedAt));
    },
    resume() {
      // Only a paused utterance resumes: there is nothing to restart once the
      // section has ended or been cancelled.
      if (handle === null && handlers !== null) arm(remainingMs);
    },
  };
}
