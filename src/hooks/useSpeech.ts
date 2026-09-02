"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export function useSpeech() {
  const [state, setState] = useState<SpeechState>("idle");
  const [mouthOpen, setMouthOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
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
      const exact = voices.find((v) => v.lang.toLowerCase() === bcp47.toLowerCase());
      if (exact) return exact;
      const prefix = bcp47.split("-")[0];
      return voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
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
        utterance.rate = 0.98;
        utterance.pitch = 1.02;

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
        const estimatedMs = Math.min(30_000, Math.max(4000, text.length * 90));
        watchdogRef.current = setTimeout(finish, estimatedMs);

        utterance.onstart = () => {
          setState("speaking");
          mouthTimerRef.current = setInterval(() => {
            setMouthOpen((m) => !m);
          }, 130);
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
    }, 130);
    setState("speaking");
    // The original watchdog may have already elapsed while paused; give the
    // resumed speech a fresh, generous safety window rather than none at all.
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (finishRef.current) {
      watchdogRef.current = setTimeout(finishRef.current, 20_000);
    }
  }, [state]);

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { speak, stop, pause, resume, state, mouthOpen, voicesReady: voices.length > 0 };
}
