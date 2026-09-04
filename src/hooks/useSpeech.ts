"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_VOICE_PREFS, type VoicePrefs } from "@/lib/voicePrefs";
import {
  MOUTH_FLAP_MS,
  SPEECH_MS_PER_CHAR,
  SPEECH_WATCHDOG_MAX_MS,
  SPEECH_WATCHDOG_MIN_MS,
} from "@/lib/appConfig";
import { SpeechController, type SpeechOutcome, type SpeechState } from "@/lib/speech/controller";
import { availableVoices, createBrowserEngine, speechSupported } from "@/lib/speech/browserEngine";

export type { SpeechOutcome, SpeechState };

const LANGUAGE_TO_BCP47: Record<string, string> = {
  english: "en-US",
  hindi: "hi-IN",
  hinglish: "hi-IN",
  spanish: "es-ES",
  french: "fr-FR",
  german: "de-DE",
  japanese: "ja-JP",
  chinese: "zh-CN",
  mandarin: "zh-CN",
  arabic: "ar-SA",
  portuguese: "pt-BR",
  russian: "ru-RU",
  tamil: "ta-IN",
  telugu: "te-IN",
  marathi: "mr-IN",
  bengali: "bn-IN",
  gujarati: "gu-IN",
  kannada: "kn-IN",
  malayalam: "ml-IN",
  punjabi: "pa-IN",
  // ur-PK, not ur-IN: no speech engine ships an Urdu-India voice, and
  // Windows/Android ship Urdu as ur-PK. The prefix fallback covers either.
  urdu: "ur-PK",
  korean: "ko-KR",
  italian: "it-IT",
};

export function languageToBCP47(language: string): string {
  const key = language.trim().toLowerCase();
  return LANGUAGE_TO_BCP47[key] || (key.length <= 5 && key.includes("-") ? language : "en-US");
}

/**
 * The browser's installed voices. Chrome populates the list asynchronously and
 * returns an empty array on the first call, so every consumer has to listen for
 * `voiceschanged` — this keeps that in one place.
 */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!speechSupported()) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}

/**
 * Whether this device can actually narrate a teaching language.
 *
 * The app offers 22 languages, but speech voices come from the operating
 * system, and a typical macOS install has none for Marathi, Gujarati,
 * Malayalam, Punjabi or Urdu. Without a voice the browser does not error — it
 * silently skips the unpronounceable text and fires `onend` almost
 * immediately, so a lesson would race through its sections looking like it had
 * been taught. Callers use this to say so up front instead.
 */
export function hasVoiceFor(language: string, voices: SpeechSynthesisVoice[]): boolean {
  if (voices.length === 0) return true; // Not loaded yet — don't warn prematurely.
  const prefix = languageToBCP47(language).split("-")[0].toLowerCase();
  return voices.some((v) => v.lang.toLowerCase().startsWith(prefix));
}

/**
 * Narration, on top of the state machine in `@/lib/speech/controller`.
 *
 * H9: this hook used to hold one shared completion callback, which produced
 * three races — `stop()` never resolved the promise it cancelled, a new
 * utterance overwrote the previous one's pending completion, and the watchdog
 * kept running across a pause. All of that now lives in the controller, where
 * it is covered by deterministic tests; what is left here is React glue and
 * voice selection.
 *
 * `speak` resolves with *why* narration finished. A caller that advances the
 * lesson must check for "ended" — advancing on "cancelled" is how skipping a
 * section or pausing used to jump the lesson forward.
 */
export function useSpeech(prefs: VoicePrefs = DEFAULT_VOICE_PREFS) {
  const [state, setState] = useState<SpeechState>("idle");
  const [mouthOpen, setMouthOpen] = useState(false);
  const voices = useVoices();

  // Read through refs so changing a slider mid-lesson does not give `speak` a
  // new identity and re-trigger the narration effect that depends on it.
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  // One controller per mounted component, created lazily so server rendering
  // never touches `window`. Held in state rather than a ref because a ref must
  // not be written during render.
  const [controller] = useState<SpeechController | null>(() =>
    speechSupported() ? new SpeechController(createBrowserEngine(), { onState: setState }) : null
  );

  // One teardown for the life of the component: anything still speaking is
  // cancelled and, crucially, its waiting caller is released.
  useEffect(() => () => controller?.dispose(), [controller]);

  // The avatar's mouth follows the state rather than being driven by its own
  // timer alongside it, so it cannot be left flapping after narration stops.
  useEffect(() => {
    if (state !== "speaking") return;
    const timer = setInterval(() => setMouthOpen((open) => !open), MOUTH_FLAP_MS);
    // Closing the mouth belongs in the cleanup, not in the effect body: it
    // runs exactly when speaking stops, and React forbids a synchronous
    // setState while an effect is running.
    return () => {
      clearInterval(timer);
      setMouthOpen(false);
    };
  }, [state]);

  const pickVoiceURI = useCallback((bcp47: string): string | undefined => {
    // Read live rather than from render state, so `speak` keeps a stable
    // identity as the browser's voice list arrives.
    const available = availableVoices();
    // An explicit choice wins, but only while it can still speak the lesson's
    // language — a learner who picked a French voice and then switched the
    // lesson to Hindi should get a Hindi voice, not French-accented Hindi.
    const prefix = bcp47.split("-")[0].toLowerCase();
    const chosenURI = prefsRef.current.voiceURI;
    if (chosenURI) {
      const chosen = available.find((v) => v.voiceURI === chosenURI);
      if (chosen && chosen.lang.toLowerCase().startsWith(prefix)) return chosen.voiceURI;
    }
    const exact = available.find((v) => v.lang.toLowerCase() === bcp47.toLowerCase());
    if (exact) return exact.voiceURI;
    return available.find((v) => v.lang.toLowerCase().startsWith(prefix))?.voiceURI;
  }, []);

  /** Voices that can speak the given teaching language, for the picker UI. */
  const voicesForLanguage = useCallback(
    (language: string): SpeechSynthesisVoice[] => {
      const prefix = languageToBCP47(language).split("-")[0].toLowerCase();
      return voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    },
    [voices]
  );

  const speak = useCallback(
    (text: string, language: string, signal?: AbortSignal): Promise<SpeechOutcome> => {
      if (!controller) return Promise.resolve<SpeechOutcome>("unsupported");
      const bcp47 = languageToBCP47(language);
      const { rate, pitch, volume } = prefsRef.current;
      return controller.speak(
        {
          text,
          lang: bcp47,
          voiceURI: pickVoiceURI(bcp47),
          rate,
          pitch,
          volume,
          // Scaled by rate: at 0.5x the same sentence takes twice as long, and
          // a watchdog that ignored that would cut slow narration off mid-word.
          watchdogMs: Math.min(
            SPEECH_WATCHDOG_MAX_MS,
            Math.max(SPEECH_WATCHDOG_MIN_MS, (text.length * SPEECH_MS_PER_CHAR) / Math.max(0.5, rate))
          ),
        },
        signal
      );
    },
    [controller, pickVoiceURI]
  );

  const stop = useCallback(() => controller?.stop(), [controller]);
  const pause = useCallback(() => controller?.pause(), [controller]);
  const resume = useCallback(() => controller?.resume(), [controller]);

  return {
    speak,
    stop,
    pause,
    resume,
    state,
    mouthOpen,
    voices,
    voicesForLanguage,
    voicesReady: voices.length > 0,
    /** False when this device has no voice for the language — offer manual progress. */
    canNarrate: (language: string) => speechSupported() && hasVoiceFor(language, voices),
  };
}
