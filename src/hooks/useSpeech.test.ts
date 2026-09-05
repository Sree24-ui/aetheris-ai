import { test } from "node:test";
import assert from "node:assert/strict";
import { hasVoiceFor, languageToBCP47, narrationRequest } from "./useSpeech";
import { createNarrationEngine, type VoiceLike } from "@/lib/speech/browserEngine";
import { SpeechController, type EngineHandlers, type SpeechEngine, type SpeechRequest } from "@/lib/speech/controller";
import { DEFAULT_VOICE_PREFS } from "@/lib/voicePrefs";

/**
 * The contract between the lesson and the speech layer, asserted end to end
 * without a browser: given the text, the language, the learner's preferences
 * and the voices this device actually has, does the utterance reach a real
 * engine, and which one?
 */

const voice = (lang: string, voiceURI = `${lang}-voice`): VoiceLike => ({ lang, voiceURI });

/** A desktop's worth of voices, as reported by a healthy browser. */
const INSTALLED: VoiceLike[] = [
  voice("en-US", "Samantha"),
  voice("en-US", "Alex"),
  voice("en-GB", "Daniel"),
  voice("fr-FR", "Amelie"),
];

const build = (language: string, voices = INSTALLED, prefs = DEFAULT_VOICE_PREFS) =>
  narrationRequest({ text: "Gradient is rise over run.", language, prefs, voices });

test("an English lesson on a device with English voices is spoken, not silenced", () => {
  const request = build("english");
  assert.equal(request.lang, "en-US");
  assert.equal(request.voiceURI, "Samantha");
  assert.equal(request.silentMs, undefined, "a spoken request must carry no silent duration");
});

test("a language with no installed voice is routed to the silent timer", () => {
  const request = build("marathi");
  assert.equal(request.lang, "mr-IN");
  assert.equal(request.voiceURI, undefined);
  assert.ok((request.silentMs ?? 0) > 0);
});

test("a device reporting no voices at all still gets a runnable request", () => {
  const request = build("english", []);
  assert.ok((request.silentMs ?? 0) > 0, "silence, rather than an utterance that ends instantly");
});

test("the watchdog is always above the reading estimate, never equal to it", () => {
  // Equal, and a silent section ends as "timeout" — which the lesson treats as
  // a failure to narrate rather than a section taught.
  for (const language of ["english", "marathi"]) {
    const request = build(language);
    assert.ok(request.watchdogMs > (request.silentMs ?? 0));
  }
});

test("a slower speaking rate lengthens the estimate rather than truncating speech", () => {
  const normal = narrationRequest({
    text: "x".repeat(400),
    language: "marathi",
    prefs: DEFAULT_VOICE_PREFS,
    voices: INSTALLED,
  });
  const slow = narrationRequest({
    text: "x".repeat(400),
    language: "marathi",
    prefs: { ...DEFAULT_VOICE_PREFS, rate: 0.5 },
    voices: INSTALLED,
  });
  assert.ok(slow.silentMs! > normal.silentMs!);
});

test("the learner's chosen voice is used when it speaks the lesson's language", () => {
  const request = build("english", INSTALLED, { ...DEFAULT_VOICE_PREFS, voiceURI: "Alex" });
  assert.equal(request.voiceURI, "Alex");
});

test("a chosen voice from another language does not silence the lesson", () => {
  // It is dropped in favour of one that can speak the language, not treated
  // as "no voice available".
  const request = build("english", INSTALLED, { ...DEFAULT_VOICE_PREFS, voiceURI: "Amelie" });
  assert.equal(request.voiceURI, "Samantha");
  assert.equal(request.silentMs, undefined);
});

test("unknown language names fall back to English rather than to silence", () => {
  assert.equal(languageToBCP47("Klingon"), "en-US");
  assert.equal(build("Klingon").silentMs, undefined);
});

test("the no-voice banner stays quiet until the voice list has loaded", () => {
  assert.equal(hasVoiceFor("marathi", []), true, "an empty list is not yet evidence");
  assert.equal(hasVoiceFor("marathi", INSTALLED), false);
  assert.equal(hasVoiceFor("english", INSTALLED), true);
});

// --- the whole path, from request to engine ------------------------------

class RecordingEngine implements SpeechEngine {
  spoken: SpeechRequest[] = [];
  start(request: SpeechRequest, handlers: EngineHandlers): void {
    this.spoken.push(request);
    handlers.onStart();
  }
  cancel(): void {}
  pause(): void {}
  resume(): void {}
}

function wired() {
  const browser = new RecordingEngine();
  const silent = new RecordingEngine();
  const controller = new SpeechController(createNarrationEngine(silent, browser));
  return { browser, silent, controller };
}

test("English voice available → the browser engine is the one that speaks", () => {
  const { browser, silent, controller } = wired();
  // The lifecycle React actually performs on mount in development.
  const detach = controller.attach();
  void controller.speak(build("english"));

  assert.equal(browser.spoken.length, 1, "the utterance must reach speechSynthesis");
  assert.equal(browser.spoken[0].voiceURI, "Samantha");
  assert.equal(silent.spoken.length, 0);
  assert.equal(controller.state, "speaking", "and the play button must offer Pause");
  detach();
});

test("no voice for the language → the silent engine, and still not idle", () => {
  const { browser, silent, controller } = wired();
  controller.attach();
  void controller.speak(build("marathi"));

  assert.equal(silent.spoken.length, 1);
  assert.equal(browser.spoken.length, 0, "speechSynthesis must not be handed unspeakable text");
  assert.equal(controller.state, "speaking");
});

test("a Play click after React's development remount still reaches an engine", () => {
  // The bug this pins: the controller lives in component state, which survives
  // the remount React simulates on every mount in development, but the effect
  // cleanup disposed it. Nothing re-armed it, so `speak()` returned
  // "cancelled" from its first line — speechSynthesis was never touched, the
  // silent engine never started, the state never left "idle" and the play
  // button toggled nothing, on every lesson, in every language.
  const { browser, controller } = wired();
  controller.attach()(); // setup, then the cleanup React runs straight away
  controller.attach(); // and the setup it runs on the way back in

  void controller.speak(build("english"));
  assert.equal(browser.spoken.length, 1, "Play must still reach the engine");
  assert.notEqual(controller.state, "idle", "and the state must leave idle");
});

test("a real unmount still refuses to speak", () => {
  // Re-arming must not cost the guarantee that a torn-down lesson goes quiet.
  const { browser, silent, controller } = wired();
  const detach = controller.attach();
  detach();
  void controller.speak(build("english"));
  assert.equal(browser.spoken.length, 0);
  assert.equal(silent.spoken.length, 0);
});
