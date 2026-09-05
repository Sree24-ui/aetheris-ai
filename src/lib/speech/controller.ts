/**
 * The narration state machine (H9).
 *
 * `useSpeech` kept one shared completion callback in a ref. That produced
 * three separate races, all of which a learner hits in an ordinary lesson:
 *
 *  - `stop()` cleared the callback without resolving the promise it belonged
 *    to, so `await speak(...)` never returned and the lesson froze.
 *  - Starting a new utterance overwrote the pending completion of the old
 *    one, so the previous section's promise settled against the new
 *    utterance's events — narration overlapped, or a section was skipped.
 *  - The watchdog kept running across a pause and fired minutes later,
 *    resolving an utterance nobody was waiting on and advancing the lesson.
 *
 * The logic lives here, behind a `SpeechEngine` interface, so all of it can be
 * driven deterministically by a fake engine in a test. The browser adapter in
 * `browserEngine.ts` is the only part that touches `window.speechSynthesis`.
 */

export type SpeechState = "idle" | "speaking" | "paused";

/**
 * Why an utterance finished. The distinction matters: a caller that advances
 * the lesson on completion must not advance when the learner cancelled.
 */
export type SpeechOutcome = "ended" | "cancelled" | "error" | "timeout";

export interface SpeechRequest {
  text: string;
  /** BCP-47 tag for the utterance. */
  lang: string;
  /** Chosen voice, or undefined to let the engine pick. */
  voiceURI?: string;
  rate: number;
  pitch: number;
  volume: number;
  /**
   * How long to wait before giving up. Some browsers never fire onend at all
   * (restricted permissions, headless), and without an upper bound the lesson
   * waits forever on narration that will never finish.
   */
  watchdogMs: number;
  /**
   * Set when no installed voice can speak this text, to the time the text
   * takes to read.
   *
   * A device with no voice for the lesson's language used to be handed the
   * text anyway: the browser fired neither `onstart` nor `onend`, so the
   * lesson sat on an utterance that would never finish, the transport stayed
   * "idle" (so the play button re-armed the same dead utterance instead of
   * resuming), and only the watchdog eventually released it — up to a minute
   * per section. Narration is skipped in that case and the section runs on a
   * silent timer instead, so the timeline, pause/resume and completion behave
   * exactly as they do with a voice. See src/lib/speech/silentEngine.ts.
   */
  silentMs?: number;
}

export interface EngineHandlers {
  onStart(): void;
  onEnd(): void;
  onError(): void;
}

export interface SpeechEngine {
  /** Begins speaking. May invoke the handlers any number of times. */
  start(request: SpeechRequest, handlers: EngineHandlers): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export interface ControllerHooks {
  /** Called whenever the state changes, never with the same value twice. */
  onState?(state: SpeechState): void;
  /** Injectable so tests can drive time without waiting. */
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

interface Pending {
  id: number;
  /** Resolves the promise for this utterance. Called at most once. */
  settle(outcome: SpeechOutcome): void;
  timer: unknown;
  /** Watchdog time still owed, recomputed on pause. */
  remainingMs: number;
  /** When the current watchdog window started. */
  startedAt: number;
}

/** Never leave a resumed utterance with a watchdog too short to finish. */
const MIN_RESUME_WATCHDOG_MS = 1000;

export class SpeechController {
  private readonly engine: SpeechEngine;
  private readonly hooks: ControllerHooks;
  private pending: Pending | null = null;
  private nextId = 1;
  private currentState: SpeechState = "idle";
  private disposed = false;

  constructor(engine: SpeechEngine, hooks: ControllerHooks = {}) {
    this.engine = engine;
    this.hooks = hooks;
  }

  get state(): SpeechState {
    return this.currentState;
  }

  /** True while an utterance is in flight, whether speaking or paused. */
  get busy(): boolean {
    return this.pending !== null;
  }

  private now(): number {
    return this.hooks.now ? this.hooks.now() : Date.now();
  }

  private setTimer(fn: () => void, ms: number): unknown {
    return this.hooks.setTimer ? this.hooks.setTimer(fn, ms) : setTimeout(fn, ms);
  }

  private clearTimer(handle: unknown): void {
    if (handle === null || handle === undefined) return;
    if (this.hooks.clearTimer) this.hooks.clearTimer(handle);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  private setState(state: SpeechState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.hooks.onState?.(state);
  }

  /**
   * Settles the in-flight utterance exactly once and returns to idle.
   *
   * Every path out of speaking goes through here — end, error, timeout,
   * cancellation, replacement, unmount — which is what guarantees a caller's
   * `await` always returns.
   */
  private settle(outcome: SpeechOutcome): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.clearTimer(pending.timer);
    this.setState("idle");
    pending.settle(outcome);
  }

  /**
   * Speaks `request`, resolving when it finishes for any reason.
   *
   * Starting a new utterance while one is in flight cancels the old one and
   * settles its promise as "cancelled" — it does not leave it dangling, and
   * it does not let the old promise settle against the new utterance's
   * events.
   */
  speak(request: SpeechRequest, signal?: AbortSignal): Promise<SpeechOutcome> {
    if (this.disposed) return Promise.resolve("cancelled");
    if (signal?.aborted) return Promise.resolve("cancelled");

    // Supersede anything already in flight, promise and all.
    this.settle("cancelled");
    this.engine.cancel();

    const id = this.nextId++;
    return new Promise<SpeechOutcome>((resolve) => {
      let settled = false;
      const settleOnce = (outcome: SpeechOutcome) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = () => {
        if (this.isCurrent(id)) {
          this.engine.cancel();
          this.settle("cancelled");
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const startedAt = this.now();
      this.pending = {
        id,
        settle: settleOnce,
        timer: null,
        remainingMs: request.watchdogMs,
        startedAt,
      };
      this.pending.timer = this.setTimer(() => {
        if (this.isCurrent(id)) {
          this.engine.cancel();
          this.settle("timeout");
        }
      }, request.watchdogMs);

      // Every handler checks that it belongs to the utterance still in
      // flight. A late `onend` from a superseded utterance is ignored rather
      // than resolving whatever happens to be current.
      this.engine.start(request, {
        onStart: () => {
          if (this.isCurrent(id)) this.setState("speaking");
        },
        onEnd: () => {
          if (this.isCurrent(id)) this.settle("ended");
        },
        onError: () => {
          if (this.isCurrent(id)) this.settle("error");
        },
      });
    });
  }

  private isCurrent(id: number): boolean {
    return this.pending !== null && this.pending.id === id;
  }

  /** Cancels the current utterance; its promise settles as "cancelled". */
  stop(): void {
    this.engine.cancel();
    this.settle("cancelled");
  }

  /**
   * Pauses narration and suspends the watchdog.
   *
   * The watchdog used to keep counting while paused, so a learner who paused
   * to think came back to a lesson that had already moved on.
   */
  pause(): void {
    const pending = this.pending;
    if (!pending || this.currentState !== "speaking") return;
    this.clearTimer(pending.timer);
    pending.timer = null;
    pending.remainingMs = Math.max(
      MIN_RESUME_WATCHDOG_MS,
      pending.remainingMs - (this.now() - pending.startedAt)
    );
    this.engine.pause();
    this.setState("paused");
  }

  resume(): void {
    const pending = this.pending;
    if (!pending || this.currentState !== "paused") return;
    const id = pending.id;
    pending.startedAt = this.now();
    pending.timer = this.setTimer(() => {
      if (this.isCurrent(id)) {
        this.engine.cancel();
        this.settle("timeout");
      }
    }, pending.remainingMs);
    this.engine.resume();
    this.setState("speaking");
  }

  /**
   * Marks the controller live and returns its teardown, as one call.
   *
   * The two halves have to match, and keeping them separate is what broke
   * narration outright: `useSpeech` held the controller in component state —
   * which React preserves across the remount it simulates on every mount in
   * development — but disposed it from an effect cleanup that runs on that
   * remount. Nothing re-armed it, so every lesson came back holding a
   * permanently disposed controller: `speak()` resolved "cancelled" from its
   * first line without ever reaching an engine, so no section was ever
   * narrated, the state never left "idle", and the play button toggled
   * nothing. Returning the teardown from the setup makes that asymmetry
   * impossible to write.
   */
  attach(): () => void {
    this.disposed = false;
    return () => this.dispose();
  }

  /** Tears down on unmount. Any waiter is released rather than stranded. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.cancel();
    this.settle("cancelled");
  }
}
