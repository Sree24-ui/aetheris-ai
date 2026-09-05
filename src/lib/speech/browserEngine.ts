import type { EngineHandlers, SpeechEngine, SpeechRequest } from "./controller";
import { createSilentEngine } from "./silentEngine";

/**
 * The only part of narration that touches `window.speechSynthesis`.
 *
 * Everything about ordering, cancellation and watchdogs lives in
 * SpeechController, which is why this file has no logic worth testing and the
 * state machine has tests that need no browser.
 */
export function createBrowserEngine(): SpeechEngine {
  const synth = window.speechSynthesis;
  // Utterances are held until they finish. Chrome has long-standing bugs
  // where an utterance collected mid-speech stops firing its events, so a
  // live reference is kept for as long as the engine could still speak it.
  const inFlight = new Set<SpeechSynthesisUtterance>();

  return {
    start(request: SpeechRequest, handlers: EngineHandlers) {
      const utterance = new SpeechSynthesisUtterance(request.text);
      utterance.lang = request.lang;
      // Read at speak time rather than captured: Chrome populates the voice
      // list asynchronously, so a list captured earlier can still be empty.
      const voice = request.voiceURI
        ? window.speechSynthesis.getVoices().find((v) => v.voiceURI === request.voiceURI)
        : undefined;
      if (voice) utterance.voice = voice;
      utterance.rate = request.rate;
      utterance.pitch = request.pitch;
      utterance.volume = request.volume;
      utterance.onstart = () => handlers.onStart();
      utterance.onend = () => {
        inFlight.delete(utterance);
        handlers.onEnd();
      };
      utterance.onerror = () => {
        inFlight.delete(utterance);
        handlers.onError();
      };
      inFlight.add(utterance);
      synth.speak(utterance);
    },
    cancel() {
      inFlight.clear();
      synth.cancel();
    },
    pause() {
      synth.pause();
    },
    resume() {
      synth.resume();
    },
  };
}

/**
 * Narration that speaks when the device can and keeps time when it cannot.
 *
 * A request carrying `silentMs` is one `useSpeech` has already established no
 * installed voice can speak (see `pickVoice`); it runs on the silent engine so
 * the lesson's timeline continues at reading pace. Everything else goes to the
 * browser, which is built lazily — a device with no speech synthesis at all
 * must never have `window.speechSynthesis` read on it.
 */
export function createNarrationEngine(
  silent: SpeechEngine = createSilentEngine(),
  /** Injectable so the routing can be asserted without a browser. */
  speakingEngine?: SpeechEngine
): SpeechEngine {
  let speaking: SpeechEngine | null = speakingEngine ?? null;
  let active: SpeechEngine = silent;
  return {
    start(request: SpeechRequest, handlers: EngineHandlers) {
      active =
        request.silentMs === undefined ? (speaking ??= createBrowserEngine()) : silent;
      active.start(request, handlers);
    },
    // The controller cancels before it starts anything new, so these always
    // reach the engine that owns the utterance in flight.
    cancel: () => active.cancel(),
    pause: () => active.pause(),
    resume: () => active.resume(),
  };
}

/** Enough of a voice to choose between them; the rest is browser detail. */
export type VoiceLike = Pick<SpeechSynthesisVoice, "lang" | "voiceURI">;

/**
 * The voice that should speak a language, or null when the device has none.
 *
 * Returning null is the signal that narration has to be silent — it is the one
 * decision that separates "this lesson can be spoken" from "this lesson runs
 * on a timer", so it is a pure function with tests rather than a condition
 * buried in a hook.
 *
 * An explicit preference wins, but only while it can still speak the lesson's
 * language: a learner who picked a French voice and then switched the lesson
 * to Hindi should get a Hindi voice, not French-accented Hindi.
 */
export function pickVoice<T extends VoiceLike>(
  bcp47: string,
  preferredURI: string | null | undefined,
  voices: readonly T[]
): T | null {
  const prefix = bcp47.split("-")[0].toLowerCase();
  const speaksLanguage = (v: T) => v.lang.toLowerCase().startsWith(prefix);

  if (preferredURI) {
    const chosen = voices.find((v) => v.voiceURI === preferredURI);
    if (chosen && speaksLanguage(chosen)) return chosen;
  }
  const exact = voices.find((v) => v.lang.toLowerCase() === bcp47.toLowerCase());
  return exact ?? voices.find(speaksLanguage) ?? null;
}

/** The installed voices, or an empty list where speech is unavailable. */
export function availableVoices(): SpeechSynthesisVoice[] {
  return speechSupported() ? window.speechSynthesis.getVoices() : [];
}

/** True when this browser can speak at all. */
export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
