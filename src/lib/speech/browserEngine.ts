import type { EngineHandlers, SpeechEngine, SpeechRequest } from "./controller";

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

/** The installed voices, or an empty list where speech is unavailable. */
export function availableVoices(): SpeechSynthesisVoice[] {
  return speechSupported() ? window.speechSynthesis.getVoices() : [];
}

/** True when this browser can speak at all. */
export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
