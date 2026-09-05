import { test } from "node:test";
import assert from "node:assert/strict";
import { createNarrationEngine, pickVoice, type VoiceLike } from "./browserEngine";
import type { EngineHandlers, SpeechEngine, SpeechRequest } from "./controller";

/**
 * `pickVoice` returning null is the decision that separates "this lesson can
 * be spoken" from "this lesson runs on a timer" — the single check that used
 * to be missing, which is why a Marathi lesson on a machine with no Marathi
 * voice stalled instead of continuing without narration.
 */

const voice = (lang: string, voiceURI = `${lang}-voice`): VoiceLike => ({ lang, voiceURI });

const INSTALLED = [
  voice("en-US", "Samantha"),
  voice("en-GB", "Daniel"),
  voice("fr-FR", "Amelie"),
  voice("hi-IN", "Lekha"),
];

test("an exact language match wins", () => {
  assert.equal(pickVoice("en-GB", null, INSTALLED)?.voiceURI, "Daniel");
});

test("a regional variant falls back to the same language", () => {
  // en-AU is not installed; an English voice is still the right answer.
  assert.equal(pickVoice("en-AU", null, INSTALLED)?.voiceURI, "Samantha");
});

test("no voice for the language returns null", () => {
  // The Marathi case: macOS ships no mr-* voice. This is what routes the
  // lesson to the silent engine instead of to an utterance that never fires.
  assert.equal(pickVoice("mr-IN", null, INSTALLED), null);
  assert.equal(pickVoice("gu-IN", null, INSTALLED), null);
  assert.equal(pickVoice("ur-PK", null, INSTALLED), null);
});

test("an empty voice list returns null", () => {
  assert.equal(pickVoice("en-US", null, []), null);
});

test("an explicit preference is honoured", () => {
  assert.equal(pickVoice("en-US", "Daniel", INSTALLED)?.voiceURI, "Daniel");
});

test("a preference that cannot speak the lesson's language is dropped", () => {
  // Picking a French voice and then switching the lesson to Hindi should give
  // a Hindi voice, not French-accented Hindi.
  assert.equal(pickVoice("hi-IN", "Amelie", INSTALLED)?.voiceURI, "Lekha");
});

test("a preference naming a voice that is no longer installed is dropped", () => {
  assert.equal(pickVoice("en-US", "uninstalled", INSTALLED)?.voiceURI, "Samantha");
});

test("a preference cannot rescue a language with no voice", () => {
  assert.equal(pickVoice("mr-IN", "Samantha", INSTALLED), null);
});

test("language matching ignores case", () => {
  assert.equal(pickVoice("EN-us", null, [voice("en-US")])?.lang, "en-US");
});

// --- routing --------------------------------------------------------------

class FakeEngine implements SpeechEngine {
  spoken: SpeechRequest[] = [];
  cancels = 0;
  pauses = 0;
  resumes = 0;
  start(request: SpeechRequest, handlers: EngineHandlers): void {
    this.spoken.push(request);
    handlers.onStart();
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

const noop: EngineHandlers = { onStart: () => {}, onEnd: () => {}, onError: () => {} };

const silentRequest: SpeechRequest = {
  text: "Rise over run.",
  lang: "mr-IN",
  rate: 1,
  pitch: 1,
  volume: 1,
  watchdogMs: 20_000,
  silentMs: 5_000,
};

test("a silent request never reaches window.speechSynthesis", () => {
  // There is no `window` in this process at all, so a router that built the
  // browser engine eagerly — or routed a voiceless request to it — would throw
  // here rather than merely misbehave in a browser.
  const silent = new FakeEngine();
  const engine = createNarrationEngine(silent);
  engine.start(silentRequest, noop);
  assert.equal(silent.spoken.length, 1);
});

test("pause, resume and cancel reach the engine holding the utterance", () => {
  const silent = new FakeEngine();
  const engine = createNarrationEngine(silent);
  engine.start(silentRequest, noop);
  engine.pause();
  engine.resume();
  engine.cancel();
  assert.equal(silent.pauses, 1);
  assert.equal(silent.resumes, 1);
  assert.equal(silent.cancels, 1);
});
