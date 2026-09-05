import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSilentEngine, type Timers } from "./silentEngine";
import type { EngineHandlers, SpeechEngine, SpeechRequest } from "./controller";

/**
 * A device with no voice for the lesson's language used to stall it outright.
 * `speechSynthesis.speak` was called anyway, the browser fired neither
 * `onstart` nor `onend`, and the lesson sat on an utterance that would never
 * finish — the section never advanced, and the play button re-armed the same
 * dead utterance rather than resuming.
 *
 * These pin the replacement: the same lifecycle, on a timer.
 */

class FakeClock implements Timers {
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
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let due: number | undefined;
      let dueAt = Infinity;
      for (const [handle, timer] of this.timers) {
        if (timer.at <= target && timer.at < dueAt) {
          dueAt = timer.at;
          due = handle;
        }
      }
      if (due === undefined) break;
      const timer = this.timers.get(due)!;
      this.timers.delete(due);
      this.time = timer.at;
      timer.fn();
    }
    this.time = target;
  }
  get pending(): number {
    return this.timers.size;
  }
}

function recorder() {
  const events: string[] = [];
  const handlers: EngineHandlers = {
    onStart: () => events.push("start"),
    onEnd: () => events.push("end"),
    onError: () => events.push("error"),
  };
  return { events, handlers };
}

const request = (silentMs: number | undefined = 5_000): SpeechRequest => ({
  text: "Rise over run.",
  lang: "mr-IN",
  rate: 1,
  pitch: 1,
  volume: 1,
  watchdogMs: 20_000,
  silentMs,
});

let clock: FakeClock;
let engine: SpeechEngine;

beforeEach(() => {
  clock = new FakeClock();
  engine = createSilentEngine(clock);
});

test("narration starts at once so the lesson leaves idle", () => {
  // The play/pause button reads the controller's state: an utterance that
  // never reports starting leaves a play button that re-arms itself forever.
  const { events, handlers } = recorder();
  engine.start(request(), handlers);
  assert.deepEqual(events, ["start"]);
});

test("a silent section ends after the time it takes to read", () => {
  const { events, handlers } = recorder();
  engine.start(request(5_000), handlers);
  clock.advance(4_999);
  assert.deepEqual(events, ["start"], "must not end early");
  clock.advance(1);
  assert.deepEqual(events, ["start", "end"]);
});

test("pause holds the section, and resume finishes the time that was left", () => {
  const { events, handlers } = recorder();
  engine.start(request(5_000), handlers);
  clock.advance(2_000);
  engine.pause();

  clock.advance(60_000);
  assert.deepEqual(events, ["start"], "a paused lesson must not advance");
  assert.equal(clock.pending, 0, "and must not be holding a live timer");

  engine.resume();
  clock.advance(2_999);
  assert.deepEqual(events, ["start"]);
  clock.advance(1);
  assert.deepEqual(events, ["start", "end"], "exactly the 3s that were owed");
});

test("cancelling settles nothing later", () => {
  // Skip narration, a language switch and unmount all cancel. The controller
  // settles the promise itself; a late onEnd here would resolve whatever
  // utterance happened to be current by then.
  const { events, handlers } = recorder();
  engine.start(request(5_000), handlers);
  engine.cancel();
  clock.advance(60_000);
  assert.deepEqual(events, ["start"]);
  assert.equal(clock.pending, 0);
});

test("resume after cancel does not restart a finished section", () => {
  const { events, handlers } = recorder();
  engine.start(request(5_000), handlers);
  engine.cancel();
  engine.resume();
  clock.advance(60_000);
  assert.deepEqual(events, ["start"]);
});

test("resume without a pause is a no-op rather than a second timer", () => {
  const { events, handlers } = recorder();
  engine.start(request(5_000), handlers);
  engine.resume();
  assert.equal(clock.pending, 1);
  clock.advance(5_000);
  assert.deepEqual(events, ["start", "end"]);
});

test("an empty section still ends", () => {
  // Nothing to read is a section to move past, not a section to hang on.
  const { events, handlers } = recorder();
  engine.start(request(0), handlers);
  clock.advance(0);
  assert.deepEqual(events, ["start", "end"]);
});

test("a second section supersedes the first without double-ending", () => {
  const first = recorder();
  engine.start(request(5_000), first.handlers);
  engine.cancel();
  const second = recorder();
  engine.start(request(1_000), second.handlers);
  clock.advance(10_000);
  assert.deepEqual(first.events, ["start"]);
  assert.deepEqual(second.events, ["start", "end"]);
});
