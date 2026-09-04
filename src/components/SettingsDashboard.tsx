"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Icon from "./Icon";
import {
  ACCENTS,
  ACCENT_KEYS,
  DEFAULT_APPEARANCE,
  DENSITIES,
  MOTIONS,
  getAppearanceServerSnapshot,
  getAppearanceSnapshot,
  setAppearance,
  subscribeAppearance,
  type Density,
  type Motion,
} from "@/lib/appearance";
import {
  DEFAULT_VOICE_PREFS,
  getVoicePrefsServerSnapshot,
  getVoicePrefsSnapshot,
  setVoicePrefs,
  subscribeVoicePrefs,
  type VoicePrefs,
} from "@/lib/voicePrefs";

type Section = "atmosphere" | "narration";

const DENSITY_LABEL: Record<Density, string> = { off: "Off", sparse: "Sparse", dense: "Dense" };
const MOTION_LABEL: Record<Motion, string> = { still: "Still", calm: "Calm", fluid: "Fluid" };

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
    <label className="flex flex-col gap-2">
      <span className="flex items-center justify-between font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant">
        {label}
        <span className="tabular-nums text-on-surface normal-case tracking-normal">{format(value)}</span>
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

export default function SettingsDashboard({ onGoProfile }: { onGoProfile: () => void }) {
  const [section, setSection] = useState<Section>("atmosphere");

  const appearance = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getAppearanceServerSnapshot
  );
  const voice = useSyncExternalStore(
    subscribeVoicePrefs,
    getVoicePrefsSnapshot,
    getVoicePrefsServerSnapshot
  );

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);

  // Chrome populates the voice list asynchronously and fires `voiceschanged`
  // once it has; reading it only on mount returns an empty array there.
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    const read = () => setVoices(synth.getVoices());
    read();
    synth.addEventListener("voiceschanged", read);
    return () => {
      synth.removeEventListener("voiceschanged", read);
      synth.cancel();
    };
  }, []);

  const setVoice = (patch: Partial<VoicePrefs>) => setVoicePrefs({ ...voice, ...patch });

  function preview() {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(SAMPLE);
    const chosen = voices.find((v) => v.voiceURI === voice.voiceURI);
    if (chosen) utterance.voice = chosen;
    utterance.rate = voice.rate;
    utterance.pitch = voice.pitch;
    utterance.volume = voice.volume;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  }

  function stopPreview() {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  const motionIndex = MOTIONS.indexOf(appearance.motion);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 max-w-[1500px] mx-auto w-full">
      {/* Left rail */}
      <div className="lg:col-span-4 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <span className="font-label-caps text-label-caps text-primary uppercase tracking-widest">
            Configuration
          </span>
          <h1 className="font-display-lg text-display-lg-mobile lg:text-display-lg text-on-background">
            Interface
            <br />
            Parameters
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-4 opacity-80">
            Everything here is saved on this device and takes effect immediately.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {(
            [
              { id: "atmosphere", icon: "palette", label: "Atmosphere" },
              { id: "narration", icon: "record_voice_over", label: "Narration" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex items-center justify-between w-full p-4 rounded-2xl transition-colors ${
                section === item.id
                  ? "bg-surface-container/80 backdrop-blur-md text-on-surface"
                  : "bg-transparent text-on-surface-variant hover:bg-surface-container/30"
              }`}
            >
              <span className="flex items-center gap-4">
                <span
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    section === item.id ? "bg-primary-container/20 text-primary" : "bg-surface-variant"
                  }`}
                >
                  <Icon name={item.icon} filled={section === item.id} />
                </span>
                <span className="font-headline-md text-body-lg">{item.label}</span>
              </span>
              {section === item.id && <span className="w-2 h-2 rounded-full bg-primary" />}
            </button>
          ))}

          <button
            onClick={onGoProfile}
            className="flex items-center justify-between w-full p-4 rounded-2xl bg-transparent text-on-surface-variant hover:bg-surface-container/30 transition-colors"
          >
            <span className="flex items-center gap-4">
              <span className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center">
                <Icon name="person" />
              </span>
              <span className="font-headline-md text-body-lg">Account</span>
            </span>
            <Icon name="arrow_forward" className="text-[18px]" />
          </button>
        </div>

        <button
          onClick={() => {
            setAppearance(DEFAULT_APPEARANCE);
            setVoicePrefs(DEFAULT_VOICE_PREFS);
          }}
          className="self-start mt-2 px-5 py-2.5 rounded-full glass-bubble font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface flex items-center gap-2"
        >
          <Icon name="restart_alt" className="text-[16px]" />
          RESET ALL TO DEFAULTS
        </button>
      </div>

      {/* Right column */}
      <div className="lg:col-span-8 flex flex-col gap-8">
        {section === "atmosphere" && (
          <>
            <div className="relative w-full rounded-[2.5rem] bg-surface-container/30 backdrop-blur-2xl p-8 lg:p-10 shadow-2xl shadow-black/40 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
              <div className="relative z-10 flex flex-col gap-8">
                <div className="flex flex-wrap gap-4 justify-between items-end">
                  <div className="flex flex-col gap-1">
                    <h2 className="font-headline-md text-headline-md text-on-surface">Accent Palette</h2>
                    <p className="font-body-md text-body-md text-on-surface-variant opacity-70">
                      Recolours every accent in the app — buttons, highlights, progress, the avatar glow.
                    </p>
                  </div>
                  <span className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-surface-dim/50">
                    <Icon name="auto_awesome" className="text-primary text-[18px]" filled />
                    <span className="font-label-caps text-label-caps text-on-surface">
                      {ACCENTS[appearance.accent].label}
                    </span>
                  </span>
                </div>

                <div className="flex flex-wrap gap-6 sm:gap-8">
                  {ACCENT_KEYS.map((key) => {
                    const active = appearance.accent === key;
                    const { vars, label } = ACCENTS[key];
                    return (
                      <button
                        key={key}
                        onClick={() => setAppearance({ ...appearance, accent: key })}
                        aria-pressed={active}
                        className="flex flex-col items-center gap-3 group"
                      >
                        <span className="relative w-24 h-24 flex items-center justify-center">
                          <span
                            className={`absolute inset-0 rounded-full blur-xl transition-opacity duration-500 ${
                              active ? "opacity-100" : "opacity-0 group-hover:opacity-70"
                            }`}
                            style={{ background: vars["--color-primary-container"] }}
                          />
                          <span
                            className={`relative w-20 h-20 rounded-full shadow-lg flex items-center justify-center transition-transform duration-500 ${
                              active ? "scale-110" : "group-hover:scale-105"
                            }`}
                            style={{
                              backgroundImage: `linear-gradient(to bottom right, ${vars["--color-primary-container"]}, ${vars["--color-primary"]})`,
                            }}
                          >
                            <span className="absolute inset-2 rounded-full bg-gradient-to-tr from-transparent to-white/20" />
                            <Icon
                              name="check"
                              className={`relative transition-opacity duration-300 ${active ? "opacity-100" : "opacity-0"}`}
                            />
                          </span>
                        </span>
                        <span
                          className={`font-label-caps text-label-caps transition-colors ${
                            active ? "text-on-surface" : "text-on-surface-variant group-hover:text-on-surface"
                          }`}
                        >
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-[2rem] bg-surface-container-highest/20 backdrop-blur-lg p-8 flex flex-col gap-6 shadow-xl shadow-black/10">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-headline-md text-body-lg text-on-surface">Bubble Density</h3>
                    <p className="font-body-md text-sm text-on-surface-variant opacity-60">
                      How much of the drifting background is drawn.
                    </p>
                  </div>
                  <span className="w-12 h-12 shrink-0 rounded-full bg-surface-container-low flex items-center justify-center text-primary/70">
                    <Icon name="bubble_chart" />
                  </span>
                </div>
                <div className="mt-auto flex items-center gap-1 bg-surface-dim rounded-full p-2">
                  {DENSITIES.map((d) => (
                    <button
                      key={d}
                      onClick={() => setAppearance({ ...appearance, density: d })}
                      aria-pressed={appearance.density === d}
                      className={`flex-1 py-3 px-2 rounded-full font-label-caps text-label-caps text-center transition-all ${
                        appearance.density === d
                          ? "bg-surface-bright text-on-surface shadow-sm"
                          : "text-on-surface-variant hover:text-on-surface"
                      }`}
                    >
                      {DENSITY_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] bg-surface-container-highest/20 backdrop-blur-lg p-8 flex flex-col gap-6 shadow-xl shadow-black/10">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-headline-md text-body-lg text-on-surface">Motion Intensity</h3>
                    <p className="font-body-md text-sm text-on-surface-variant opacity-60">
                      &ldquo;Still&rdquo; stops every ambient animation.
                    </p>
                  </div>
                  <span className="w-12 h-12 shrink-0 rounded-full bg-surface-container-low flex items-center justify-center text-secondary/70">
                    <Icon name="animation" />
                  </span>
                </div>
                <label className="mt-auto flex flex-col gap-3">
                  <span className="flex items-center justify-between font-label-caps text-label-caps text-on-surface-variant">
                    Still
                    <span className="text-on-surface">{MOTION_LABEL[appearance.motion]}</span>
                    Fluid
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={MOTIONS.length - 1}
                    step={1}
                    value={motionIndex}
                    onChange={(e) =>
                      setAppearance({ ...appearance, motion: MOTIONS[Number(e.target.value)] })
                    }
                    aria-label="Motion intensity"
                    className="w-full accent-secondary cursor-pointer"
                  />
                </label>
              </div>
            </div>

            <div className="w-full rounded-[2rem] p-8 relative overflow-hidden bg-surface-container-low/40 border border-white/5 flex flex-wrap items-center justify-between gap-6">
              <div className="ambient-blob blob-1 !absolute !opacity-40" aria-hidden />
              <div className="relative z-10 flex items-center gap-4">
                <span className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center animate-float">
                  <Icon name="visibility" className="text-primary" />
                </span>
                <div>
                  <p className="font-headline-md text-body-lg text-on-surface">Live preview</p>
                  <p className="font-body-md text-sm text-on-surface-variant">
                    This panel uses the settings above — the whole app already has too.
                  </p>
                </div>
              </div>
              <button className="btn-sheen relative z-10 px-6 py-3 rounded-full bg-primary text-on-primary font-label-caps text-label-caps overflow-hidden">
                SAMPLE BUTTON
              </button>
            </div>
          </>
        )}

        {section === "narration" && (
          <div className="relative w-full rounded-[2.5rem] bg-surface-container/30 backdrop-blur-2xl p-8 lg:p-10 shadow-2xl shadow-black/40 flex flex-col gap-8">
            <div className="flex flex-col gap-1">
              <h2 className="font-headline-md text-headline-md text-on-surface">Narration Voice</h2>
              <p className="font-body-md text-body-md text-on-surface-variant opacity-70">
                Used by the avatar in every lesson. Narration runs on your browser&apos;s built-in
                speech, so the voices listed depend on your operating system.
              </p>
            </div>

            {voices.length === 0 ? (
              <p className="font-body-md text-sm text-on-surface-variant rounded-2xl bg-surface-dim/50 p-4">
                Your browser reports no installed speech voices, so narration will use its default.
                The speed, pitch and volume below still apply.
              </p>
            ) : (
              <label className="flex flex-col gap-2">
                <span className="font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant">
                  Voice
                </span>
                <select
                  value={voice.voiceURI ?? ""}
                  onChange={(e) => setVoice({ voiceURI: e.target.value || null })}
                  className="rounded-full bg-surface-container-low/70 border border-white/8 px-5 py-4 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary/40"
                >
                  <option className="bg-surface-container-high" value="">
                    Automatic (match the lesson language)
                  </option>
                  {voices.map((v) => (
                    <option className="bg-surface-container-high" key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <Slider
                label="Speed"
                value={voice.rate}
                min={0.5}
                max={1.5}
                step={0.01}
                format={(v) => `${v.toFixed(2)}×`}
                onChange={(rate) => setVoice({ rate })}
              />
              <Slider
                label="Pitch"
                value={voice.pitch}
                min={0.5}
                max={1.5}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(pitch) => setVoice({ pitch })}
              />
              <Slider
                label="Volume"
                value={voice.volume}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(volume) => setVoice({ volume })}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={speaking ? stopPreview : preview}
                className="btn-sheen px-6 py-3 rounded-full bg-primary text-on-primary font-label-caps text-label-caps flex items-center gap-2 overflow-hidden"
              >
                <Icon name={speaking ? "stop" : "play_arrow"} className="text-[18px]" />
                {speaking ? "STOP" : "PREVIEW VOICE"}
              </button>
              <button
                onClick={() => setVoicePrefs(DEFAULT_VOICE_PREFS)}
                className="px-6 py-3 rounded-full glass-bubble font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface"
              >
                RESET VOICE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
