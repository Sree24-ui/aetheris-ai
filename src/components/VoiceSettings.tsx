"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { DEFAULT_VOICE_PREFS, type VoicePrefs } from "@/lib/voicePrefs";

interface Props {
  prefs: VoicePrefs;
  onChange: (prefs: VoicePrefs) => void;
  /** Voices that can speak the lesson's current language. */
  voices: SpeechSynthesisVoice[];
  /** Speaks a sample so the learner can hear a change before committing. */
  onPreview: (text: string) => void;
  /** Stops a running preview. */
  onStopPreview: () => void;
  disabled?: boolean;
}

const SAMPLE = "This is how I will sound while teaching your lesson.";

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-xs text-on-surface-variant">
        {label}
        <span className="tabular-nums text-on-surface">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary cursor-pointer"
      />
    </label>
  );
}

export default function VoiceSettings({
  prefs,
  onChange,
  voices,
  onPreview,
  onStopPreview,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape, so the panel behaves like every
  // other popover the learner has used.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const set = (patch: Partial<VoicePrefs>) => onChange({ ...prefs, ...patch });

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-label="Voice settings"
        title="Voice settings"
        className={`glass-bubble rounded-full px-3 py-2 text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
          open ? "active text-primary" : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        <Icon name="record_voice_over" className="text-[16px]" />
        Voice
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 z-30 glass-popover rounded-xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-on-surface flex items-center gap-2">
              <Icon name="record_voice_over" className="text-[18px] text-primary" />
              Narration voice
            </h4>
            <button
              onClick={() => onChange(DEFAULT_VOICE_PREFS)}
              className="text-[11px] text-on-surface-variant hover:text-tertiary-fixed-dim underline"
            >
              Reset
            </button>
          </div>

          {voices.length === 0 ? (
            <p className="text-xs text-on-surface-variant">
              Your browser has no speech voices installed for this language, so narration will use
              its default voice.
            </p>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-on-surface-variant">Voice</span>
              <select
                value={prefs.voiceURI ?? ""}
                onChange={(e) => set({ voiceURI: e.target.value || null })}
                className="rounded-lg bg-surface-container/60 border border-white/10 px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary/40"
              >
                <option className="bg-surface-container-high" value="">
                  Automatic (match language)
                </option>
                {voices.map((v) => (
                  <option className="bg-surface-container-high" key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
          )}

          <Slider
            label="Speed"
            value={prefs.rate}
            min={0.5}
            max={1.5}
            step={0.01}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(rate) => set({ rate })}
          />
          <Slider
            label="Pitch"
            value={prefs.pitch}
            min={0.5}
            max={1.5}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(pitch) => set({ pitch })}
          />
          <Slider
            label="Volume"
            value={prefs.volume}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(volume) => set({ volume })}
          />

          <div className="flex gap-2">
            <button
              onClick={() => onPreview(SAMPLE)}
              className="flex-1 px-3 py-2 rounded-full bg-primary-container text-on-primary-container text-xs font-medium flex items-center justify-center gap-1.5"
            >
              <Icon name="play_arrow" className="text-[16px]" />
              Preview
            </button>
            <button
              onClick={onStopPreview}
              className="px-3 py-2 rounded-full glass-bubble text-xs text-on-surface-variant hover:text-on-surface"
            >
              Stop
            </button>
          </div>

          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            Saved on this device. Narration uses your browser&apos;s built-in speech, so the voices
            listed depend on your operating system.
          </p>
        </div>
      )}
    </div>
  );
}
