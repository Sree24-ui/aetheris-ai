"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_VOICE_PREFS, type VoicePrefs } from "@/lib/voicePrefs";
import {
  MOUTH_FLAP_MS,
  SPEECH_MS_PER_CHAR,
  SPEECH_WATCHDOG_MAX_MS,
  SPEECH_WATCHDOG_MIN_MS,
  SPEECH_WATCHDOG_SLACK_MS,
} from "@/lib/appConfig";
import {
  SpeechController,
  type SpeechOutcome,
  type SpeechRequest,
  type SpeechState,
} from "@/lib/speech/controller";
import {
  availableVoices,
  createNarrationEngine,
  pickVoice,
  speechSupported,
  type VoiceLike,
} from "@/lib/speech/browserEngine";

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
 * Malayalam, Punjabi or Urdu. Callers use this to tell the learner up front
 * that the lesson will run without narration; `speak` independently routes
 * those lessons to the silent engine so the timeline still advances.
 */
export function hasVoiceFor(language: string, voices: readonly VoiceLike[]): boolean {
  if (voices.length === 0) return true; // Not loaded yet — don't warn prematurely.
  return pickVoice(languageToBCP47(language), null, voices) !== null;
}

/**
 * The utterance a lesson asks for, given what this device can actually speak.
 *
 * Pure and exported so the decision that matters — spoken or silent, and with
 * which voice — can be asserted without a browser or a rendered component.
 */
export function narrationRequest(input: {
  text: string;
  language: string;
  prefs: VoicePrefs;
  voices: readonly VoiceLike[];
}): SpeechRequest {
  const bcp47 = languageToBCP47(input.language);
  const { rate, pitch, volume } = input.prefs;
  const voice = pickVoice(bcp47, input.prefs.voiceURI, input.voices);

  // Scaled by rate: at 0.5x the same sentence takes twice as long, and a
  // reading estimate that ignored that would cut narration off mid-word.
  const readingMs = Math.min(
    SPEECH_WATCHDOG_MAX_MS,
    Math.max(SPEECH_WATCHDOG_MIN_MS, (input.text.length * SPEECH_MS_PER_CHAR) / Math.max(0.5, rate))
  );

  return {
    text: input.text,
    lang: bcp47,
    voiceURI: voice?.voiceURI,
    rate,
    pitch,
    volume,
    // The watchdog sits above the reading estimate rather than on it, so
    // narration that runs slower than the estimate is not cut off, and so the
    // silent path always ends on its own timer rather than on the backstop.
    watchdogMs: readingMs + SPEECH_WATCHDOG_SLACK_MS,
    // No voice — including a browser with no voice list at all, where
    // `speechSynthesis` reports an utterance as started and ended within a few
    // milliseconds and the lesson would otherwise flash through every section
    // unnarrated and untaught.
    //
    // Chrome populates the voice list asynchronously, so a cold call can return
    // [] on a device that does have voices; `useVoices` re-renders when they
    // arrive and the next utterance is spoken. Erring towards silence costs at
    // most one section's narration, where erring the other way costs the
    // section itself.
    silentMs: voice ? undefined : readingMs,
  };
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
  //
  // Built unconditionally, including where the browser has no speech synthesis
  // at all: the narration engine only reaches for `window.speechSynthesis` when
  // a request actually asks to be spoken, and a device that cannot speak still
  // needs a controller to run the lesson's timeline.
  const [controller] = useState(
    () => new SpeechController(createNarrationEngine(), { onState: setState })
  );

  // Setup and teardown as one call. Anything still speaking is cancelled on
  // unmount and its waiting caller released — and the controller is re-armed
  // on the way back in, which a bare cleanup did not do: React simulates a
  // remount on every mount in development, and the controller survives it in
  // component state, so a teardown with no matching setup left every lesson
  // holding a permanently disposed controller. See SpeechController.attach.
  useEffect(() => controller.attach(), [controller]);

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

  /** Voices that can speak the given teaching language, for the picker UI. */
  const voicesForLanguage = useCallback(
    (language: string): SpeechSynthesisVoice[] => {
      const prefix = languageToBCP47(language).split("-")[0].toLowerCase();
      return voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    },
    [voices]
  );

  const speak = useCallback(
    (text: string, language: string, signal?: AbortSignal): Promise<SpeechOutcome> =>
      controller.speak(
        narrationRequest({
          text,
          language,
          prefs: prefsRef.current,
          // Read live rather than from render state, so `speak` keeps a stable
          // identity as the browser's voice list arrives.
          voices: availableVoices(),
        }),
        signal
      ),
    [controller]
  );

  const stop = useCallback(() => controller.stop(), [controller]);
  const pause = useCallback(() => controller.pause(), [controller]);
  const resume = useCallback(() => controller.resume(), [controller]);

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
    /**
     * False when this device has no voice for the language. The lesson still
     * runs — narration is what is missing, not progress — so this drives an
     * explanatory note rather than any control.
     */
    canNarrate: (language: string) => speechSupported() && hasVoiceFor(language, voices),
  };
}
