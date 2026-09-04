import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  SpeechController,
  type EngineHandlers,
  type SpeechEngine,
  type SpeechRequest,
} from "./controller";

/**
 * Regression tests for H9, driven by a fake engine and a fake clock so every
 * race is deterministic rather than timing-dependent.
 *
 * The bugs being pinned: `stop()` used to clear the completion callback
 * without resolving its promise (the lesson froze on an `await` that never
 * returned); a new utterance overwrote the previous one's pending completion
 * (narration overlapped, or a section was skipped); and the watchdog kept
 * running across a pause (the lesson advanced while the learner was thinking).
 */

/** A speech engine that fires nothing until a test tells it to. */
class FakeEngine implements SpeechEngine {
  handlers: EngineHandlers | null = null;
  spoken: SpeechRequest[] = [];
  cancels = 0;
  pauses = 0;
  resumes = 0;

  start(request: SpeechRequest, handlers: EngineHandlers): void {
    this.spoken.push(request);
    this.handlers = handlers;
  }
  cancel(): void {
    this.cancels += 1;
  }
  pause(): void {
    this.pauses += 1;
  }
  resume(): void {
    this.resumes += 1;
  }
}

/** A clock whose timers only fire when a test advances it. */
class FakeClock {
  private time = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextHandle = 1;

  now = (): number => this.time;
  setTimer = (fn: () => void, ms: number): unknown => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.time + ms, fn });
    return handle;
  };
  clearTimer = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };
  /** Moves time forward, firing anything that comes due. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let nextHandle: number | undefined;
      let nextAt = Infinity;
      for (const [handle, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextHandle = handle;
        }
      }
      if (nextHandle === undefined) break;
      const timer = this.timers.get(nextHandle)!;
      this.timers.delete(nextHandle);
      this.time = timer.at;
      timer.fn();
    }
    this.time = target;
  }
  get pendingTimers(): number {
    return this.timers.size;
  }
}

let engine: FakeEngine;
let clock: FakeClock;
let states: string[];
let controller: SpeechController;

beforeEach(() => {
  engine = new FakeEngine();
  clock = new FakeClock();
  states = [];
  controller = new SpeechController(engine, {
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onState: (state) => states.push(state),
  });
});

const request = (text = "hello", watchdogMs = 10_000): SpeechRequest => ({
  text,
  lang: "en-US",
  rate: 1,
  pitch: 1,
  volume: 1,
  watchdogMs,
});

/** Resolves once the microtask queue has drained. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a normal utterance resolves as ended", async () => {
  const promise = controller.speak(request());
  engine.handlers!.onStart();
  assert.equal(controller.state, "speaking");
  engine.handlers!.onEnd();
  assert.equal(await promise, "ended");
  assert.equal(controller.state, "idle");
});

test("stop resolves the pending promise instead of stranding it", async () => {
  // The original bug: stop() cleared the callback and the awaiting lesson
  // never got control back.
  const promise = controller.speak(request());
  engine.handlers!.onStart();
  controller.stop();
  assert.equal(await promise, "cancelled");
  assert.equal(controller.state, "idle");
  assert.equal(engine.cancels >= 1, true);
});

test("a cancelled utterance is distinguishable from a completed one", async () => {
  // This is what lets the lesson advance on "ended" but not on "cancelled".
  const ended = controller.speak(request());
  engine.handlers!.onEnd();
  assert.equal(await ended, "ended");

  const cancelled = controller.speak(request());
  controller.stop();
  assert.equal(await cancelled, "cancelled");
});

test("a new utterance settles the previous promise rather than overwriting it", async () => {
  const first = controller.speak(request("one"));
  const second = controller.speak(request("two"));
  assert.equal(await first, "cancelled");

  engine.handlers!.onEnd();
  assert.equal(await second, "ended");
  assert.deepEqual(engine.spoken.map((r) => r.text), ["one", "two"]);
});

test("a late event from a superseded utterance is ignored", async () => {
  const first = controller.speak(request("one"));
  const firstHandlers = engine.handlers!;
  const second = controller.speak(request("two"));
  assert.equal(await first, "cancelled");

  // The old utterance's onend arrives after it was replaced. It must not
  // settle the new one.
  firstHandlers.onEnd();
  await flush();
  assert.equal(controller.busy, true, "the new utterance was settled by a stale event");

  engine.handlers!.onEnd();
  assert.equal(await second, "ended");
});

test("rapid replacement settles every promise exactly once", async () => {
  const promises = [
    controller.speak(request("a")),
    controller.speak(request("b")),
    controller.speak(request("c")),
  ];
  engine.handlers!.onEnd();
  assert.deepEqual(await Promise.all(promises), ["cancelled", "cancelled", "ended"]);
});

test("an engine error resolves rather than hanging", async () => {
  const promise = controller.speak(request());
  engine.handlers!.onError();
  assert.equal(await promise, "error");
});

// --- The watchdog ---------------------------------------------------------

test("an engine that never fires onend still releases the lesson", async () => {
  // Several browsers do exactly this when no voice is installed.
  const promise = controller.speak(request("hello", 5000));
  engine.handlers!.onStart();
  clock.advance(5000);
  assert.equal(await promise, "timeout");
  assert.equal(controller.state, "idle");
});

test("the watchdog does not fire once the utterance has ended", async () => {
  const promise = controller.speak(request("hello", 5000));
  engine.handlers!.onEnd();
  assert.equal(await promise, "ended");
  clock.advance(60_000);
  assert.equal(clock.pendingTimers, 0, "a timer outlived its utterance");
});

test("pausing suspends the watchdog", async () => {
  const promise = controller.speak(request("hello", 5000));
  engine.handlers!.onStart();
  clock.advance(1000);
  controller.pause();
  assert.equal(controller.state, "paused");

  // A learner who pauses to think must not come back to a lesson that moved
  // on without them.
  clock.advance(600_000);
  assert.equal(controller.busy, true, "the watchdog fired while paused");

  controller.resume();
  assert.equal(controller.state, "speaking");
  engine.handlers!.onEnd();
  assert.equal(await promise, "ended");
});

test("resuming restores only the time that was left", async () => {
  const promise = controller.speak(request("hello", 5000));
  engine.handlers!.onStart();
  clock.advance(4000);
  controller.pause();
  controller.resume();
  clock.advance(1100);
  assert.equal(await promise, "timeout");
});

test("pause and resume are no-ops in the wrong state", () => {
  controller.pause();
  controller.resume();
  assert.equal(controller.state, "idle");
  assert.equal(engine.pauses, 0);
  assert.equal(engine.resumes, 0);
});

// --- Cancellation and teardown -------------------------------------------

test("an abort signal cancels an utterance in flight", async () => {
  const abort = new AbortController();
  const promise = controller.speak(request(), abort.signal);
  engine.handlers!.onStart();
  abort.abort();
  assert.equal(await promise, "cancelled");
});

test("an already-aborted signal never reaches the engine", async () => {
  const abort = new AbortController();
  abort.abort();
  assert.equal(await controller.speak(request(), abort.signal), "cancelled");
  assert.equal(engine.spoken.length, 0);
});

test("dispose releases a waiting caller instead of stranding it", async () => {
  const promise = controller.speak(request());
  engine.handlers!.onStart();
  controller.dispose();
  assert.equal(await promise, "cancelled");
  assert.equal(clock.pendingTimers, 0);
});

test("speaking after dispose does nothing", async () => {
  controller.dispose();
  assert.equal(await controller.speak(request()), "cancelled");
  assert.equal(engine.spoken.length, 0);
});

test("a preview during narration cancels the narration, and says so", async () => {
  // VoiceSettings previews a voice mid-lesson. The narration's promise has to
  // resolve as cancelled so the lesson does not treat it as a finished
  // section and advance.
  const narration = controller.speak(request("the lesson"));
  engine.handlers!.onStart();
  const preview = controller.speak(request("this is how I sound"));
  assert.equal(await narration, "cancelled");
  engine.handlers!.onEnd();
  assert.equal(await preview, "ended");
});

test("state is reported once per transition, never repeated", async () => {
  const promise = controller.speak(request());
  engine.handlers!.onStart();
  engine.handlers!.onStart();
  engine.handlers!.onEnd();
  await promise;
  assert.deepEqual(states, ["speaking", "idle"]);
});
