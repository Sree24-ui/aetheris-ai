"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_VOICE_PREFS, type VoicePrefs } from "@/lib/voicePrefs";
import {
  MOUTH_FLAP_MS,
  SPEECH_MS_PER_CHAR,
  SPEECH_RESUME_WATCHDOG_MS,
  SPEECH_WATCHDOG_MAX_MS,
  SPEECH_WATCHDOG_MIN_MS,
} from "@/lib/appConfig";

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
  urdu: "ur-IN",
  korean: "ko-KR",
  italian: "it-IT",
};

export function languageToBCP47(language: string): string {
  const key = language.trim().toLowerCase();
  return LANGUAGE_TO_BCP47[key] || (key.length <= 5 && key.includes("-") ? language : "en-US");
}

export type SpeechState = "idle" | "speaking" | "paused";

export function useSpeech(prefs: VoicePrefs = DEFAULT_VOICE_PREFS) {
  const [state, setState] = useState<SpeechState>("idle");
  const [mouthOpen, setMouthOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Read through a ref so changing a slider mid-lesson does not give `speak`
  // a new identity and re-trigger the narration effect that depends on it.
  // Synced in an effect rather than during render, which React forbids.
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const mouthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const pickVoice = useCallback(
    (bcp47: string): SpeechSynthesisVoice | undefined => {
      // An explicit choice wins, but only while it can still speak the lesson's
      // language — a learner who picked a French voice and then switched the
      // lesson to Hindi should get a Hindi voice, not French-accented Hindi.
      const chosenURI = prefsRef.current.voiceURI;
      if (chosenURI) {
        const chosen = voices.find((v) => v.voiceURI === chosenURI);
        const prefix = bcp47.split("-")[0].toLowerCase();
        if (chosen && chosen.lang.toLowerCase().startsWith(prefix)) return chosen;
      }
      const exact = voices.find((v) => v.lang.toLowerCase() === bcp47.toLowerCase());
      if (exact) return exact;
      const prefix = bcp47.split("-")[0];
      return voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
    },
    [voices]
  );

  /** Voices that can speak the given teaching language, for the picker UI. */
  const voicesForLanguage = useCallback(
    (language: string): SpeechSynthesisVoice[] => {
      const prefix = languageToBCP47(language).split("-")[0].toLowerCase();
      return voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    },
    [voices]
  );

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (mouthTimerRef.current) clearInterval(mouthTimerRef.current);
    // Also drop the pending watchdog — otherwise it fires minutes later and
    // resolves an utterance nobody is waiting on any more (and, on unmount,
    // touches state after teardown).
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    finishRef.current = null;
    setMouthOpen(false);
    setState("idle");
  }, []);

  const speak = useCallback(
    (text: string, language: string): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
          resolve();
          return;
        }
        window.speechSynthesis.cancel();
        const bcp47 = languageToBCP47(language);
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = bcp47;
        const voice = pickVoice(bcp47);
        if (voice) utterance.voice = voice;
        const { rate, pitch, volume } = prefsRef.current;
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.volume = volume;

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          finishRef.current = null;
          if (mouthTimerRef.current) clearInterval(mouthTimerRef.current);
          setMouthOpen(false);
          setState("idle");
          resolve();
        };
        finishRef.current = finish;
        // Some browsers/environments (headless, restricted permissions, no
        // TTS voices installed) never fire onstart/onend/onerror at all.
        // Without a watchdog, the lesson would hang forever waiting on
        // narration that will never "finish". Cap the wait at a generous
        // estimate of spoken duration so the lesson always keeps moving.
        // Scaled by rate: at 0.5x the same sentence takes twice as long, and a
        // watchdog that ignored that would cut slow narration off mid-word.
        const estimatedMs = Math.min(
          SPEECH_WATCHDOG_MAX_MS,
          Math.max(SPEECH_WATCHDOG_MIN_MS, (text.length * SPEECH_MS_PER_CHAR) / Math.max(0.5, rate))
        );
        watchdogRef.current = setTimeout(finish, estimatedMs);

        utterance.onstart = () => {
          setState("speaking");
          mouthTimerRef.current = setInterval(() => {
            setMouthOpen((m) => !m);
          }, MOUTH_FLAP_MS);
        };
        utterance.onend = finish;
        utterance.onerror = finish;

        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      });
    },
    [pickVoice]
  );

  const pause = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (state !== "speaking") return;
    window.speechSynthesis.pause();
    if (mouthTimerRef.current) clearInterval(mouthTimerRef.current);
    setMouthOpen(false);
    setState("paused");
  }, [state]);

  const resume = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (state !== "paused") return;
    window.speechSynthesis.resume();
    mouthTimerRef.current = setInterval(() => {
      setMouthOpen((m) => !m);
    }, MOUTH_FLAP_MS);
    setState("speaking");
    // The original watchdog may have already elapsed while paused; give the
    // resumed speech a fresh, generous safety window rather than none at all.
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (finishRef.current) {
      watchdogRef.current = setTimeout(finishRef.current, SPEECH_RESUME_WATCHDOG_MS);
    }
  }, [state]);

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  };
}
