"use client";

import { useState } from "react";
import Icon from "./Icon";
import type { LearnerProfile, DocumentSummary } from "@/lib/types";
import { LANGUAGES } from "@/lib/languages";

const LEVELS: { value: LearnerProfile["level"]; label: string; icon: string }[] = [
  { value: "beginner", label: "Beginner", icon: "filter_1" },
  { value: "intermediate", label: "Intermediate", icon: "filter_2" },
  { value: "advanced", label: "Advanced", icon: "filter_3" },
];

const TIME_PRESETS = [
  { minutes: 5, label: "Quick Review" },
  { minutes: 20, label: "Deep Dive" },
  { minutes: 60, label: "Mastery" },
];

const STYLES = [
  { value: "visual, with lots of analogies", label: "Visual & Analogies", icon: "visibility" },
  { value: "practical, with applied examples", label: "Practical & Applied", icon: "science" },
  { value: "theoretical and rigorous", label: "Theoretical Rigor", icon: "functions" },
];

interface Props {
  initialTopic?: string;
  initialDoc?: DocumentSummary | null;
  onSubmit: (params: { topic: string; profile: LearnerProfile; docId?: string }) => void;
  onLearningPath: (params: { topic: string; profile: LearnerProfile }) => void;
  onBack: () => void;
}

export default function ConfigForm({ initialTopic, initialDoc, onSubmit, onLearningPath, onBack }: Props) {
  const [instruction, setInstruction] = useState("");
  const [parsing, setParsing] = useState(false);
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [doc, setDoc] = useState<DocumentSummary | null>(initialDoc ?? null);
  const [uploading, setUploading] = useState(false);
  const [level, setLevel] = useState<LearnerProfile["level"]>("beginner");
  const [minutes, setMinutes] = useState(20);
  const [style, setStyle] = useState(STYLES[1].value);
  const [language, setLanguage] = useState("English");
  const [objective, setObjective] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleParseInstruction() {
    if (!instruction.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/instruction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: instruction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not parse instruction");
      if (data.topic) setTopic(data.topic);
      if (data.level) setLevel(data.level);
      if (data.language) setLanguage(data.language);
      if (data.availableMinutes) setMinutes(data.availableMinutes);
      if (data.objective) setObjective(data.objective);
    } catch {
      setError("Could not parse instruction. Fill the fields manually below.");
    } finally {
      setParsing(false);
    }
  }

  async function handleUploadClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.pptx,.txt,.md";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        setDoc(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  function buildProfile(): LearnerProfile {
    return { level, language, availableMinutes: minutes, objective: objective || undefined, style };
  }

  function handleSubmit() {
    if (!topic.trim() && !doc) {
      setError("Enter a topic or upload material first.");
      return;
    }
    onSubmit({ topic: topic.trim() || doc!.filename, profile: buildProfile(), docId: doc?.docId });
  }

  return (
    <div className="max-w-[1600px] mx-auto w-full p-container-padding lg:p-8 my-4">
      <button onClick={onBack} className="text-on-surface-variant hover:text-tertiary-fixed-dim text-sm flex items-center gap-1 mb-6">
        <Icon name="arrow_back" className="text-[18px]" /> Back
      </button>

      <div className="flex flex-col lg:flex-row gap-element-gap">
        <aside className="w-full lg:w-1/3 flex flex-col gap-6">
          <div className="glass-panel rounded-2xl p-6 h-full flex flex-col gap-6 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md text-primary-fixed-dim flex items-center gap-2">
                <Icon name="description" className="text-3xl" />
                Source Material
              </h2>
              {doc && (
                <span className="font-label-caps text-label-caps bg-surface-container/50 px-3 py-1 rounded-full text-secondary border border-white/5">
                  Parsed
                </span>
              )}
            </div>

            {doc ? (
              <>
                <div className="bg-surface-container-lowest/40 rounded-xl p-4 border border-white/5 flex gap-4 items-start">
                  <div className="w-12 h-12 rounded-lg bg-primary-container/20 flex items-center justify-center flex-shrink-0">
                    <Icon name="description" className="text-primary-fixed-dim" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-body-lg text-body-lg text-on-surface mb-1 truncate">{doc.filename}</h3>
                    <p className="font-body-md text-body-md text-on-surface-variant text-sm">
                      {doc.numChunks} chunks indexed for retrieval
                    </p>
                  </div>
                </div>
                {doc.concepts.length > 0 && (
                  <div className="flex-grow flex flex-col gap-4">
                    <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">
                      Extracted Concepts
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {doc.concepts.map((c) => (
                        <span
                          key={c}
                          className="px-3 py-1.5 rounded-full glass-bubble text-sm font-body-md text-secondary-fixed"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  onClick={handleUploadClick}
                  className="mt-auto text-xs text-on-surface-variant hover:text-tertiary-fixed-dim underline self-start"
                >
                  Replace document
                </button>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-8">
                <Icon name="upload_file" className="text-5xl text-outline" />
                <p className="text-sm text-on-surface-variant max-w-xs">
                  No document uploaded — the AI Teacher will teach from general subject knowledge for this topic.
                </p>
                <button
                  onClick={handleUploadClick}
                  disabled={uploading}
                  className="px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-secondary-fixed-dim text-sm border border-white/10 disabled:opacity-50"
                >
                  {uploading ? "Processing..." : "Upload material"}
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="w-full lg:w-2/3 flex flex-col gap-8">
          <div className="mb-2">
            <h1 className="font-display-lg text-display-lg-mobile md:text-display-lg text-on-surface mb-2">Configure Session</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
              Tailor your AI mentor&apos;s approach for this session.
            </p>
          </div>

          <div>
            <label className="font-label-caps text-label-caps text-on-surface-variant flex items-center gap-2 mb-2">
              <Icon name="edit_note" className="text-sm" /> Topic or instruction
            </label>
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 text-on-surface placeholder-outline-variant focus:outline-none focus:border-primary/40"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder='Or paste a free-text instruction: "Teach me Chapter 4 in 20 minutes in Hindi"'
              />
              <button
                onClick={handleParseInstruction}
                disabled={parsing}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-secondary-fixed-dim text-sm border border-white/10 disabled:opacity-50 whitespace-nowrap"
              >
                {parsing ? "Reading..." : "Parse"}
              </button>
            </div>
            <input
              className="w-full rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 text-on-surface placeholder-outline-variant focus:outline-none focus:border-primary/40"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic, e.g. Newton's Laws of Motion"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex flex-col gap-4">
              <h3 className="font-label-caps text-label-caps text-primary-fixed-dim flex items-center gap-2">
                <Icon name="school" className="text-sm" /> Depth Level
              </h3>
              <div className="flex flex-col gap-3">
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    onClick={() => setLevel(l.value)}
                    className={`glass-bubble rounded-xl p-4 flex items-center justify-between ${level === l.value ? "active" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon name={l.icon} className={level === l.value ? "text-primary" : "text-on-surface-variant"} />
                      <span className={`font-body-md text-body-md ${level === l.value ? "text-on-surface font-medium" : "text-on-surface-variant"}`}>
                        {l.label}
                      </span>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 ${level === l.value ? "border-primary bg-primary/20" : "border-white/20"}`} />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="font-label-caps text-label-caps text-secondary-fixed-dim flex items-center gap-2">
                <Icon name="timer" className="text-sm" /> Time Available
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {TIME_PRESETS.map((t) => (
                  <button
                    key={t.minutes}
                    onClick={() => setMinutes(t.minutes)}
                    className={`glass-bubble rounded-xl py-6 flex flex-col items-center justify-center gap-2 ${minutes === t.minutes ? "active" : ""}`}
                  >
                    <span className={`font-headline-md text-headline-md ${minutes === t.minutes ? "text-secondary-fixed" : "text-on-surface-variant"}`}>
                      {t.minutes}m
                    </span>
                    <span className={`font-label-caps text-label-caps ${minutes === t.minutes ? "text-secondary-fixed/70" : "text-on-surface-variant/70"}`}>
                      {t.label}
                    </span>
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-surface-container/50 px-4 py-2 text-sm text-on-surface"
                aria-label="Custom minutes"
              />
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="font-label-caps text-label-caps text-tertiary-fixed-dim flex items-center gap-2">
                <Icon name="psychology" className="text-sm" /> Teaching Style
              </h3>
              <div className="flex flex-col gap-3">
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStyle(s.value)}
                    className={`glass-bubble rounded-xl p-4 flex items-center justify-between ${style === s.value ? "active" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon name={s.icon} className={style === s.value ? "text-tertiary" : "text-on-surface-variant"} />
                      <span className={`font-body-md text-body-md ${style === s.value ? "text-on-surface font-medium" : "text-on-surface-variant"}`}>
                        {s.label}
                      </span>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 ${style === s.value ? "border-tertiary bg-tertiary/20" : "border-white/20"}`} />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="font-label-caps text-label-caps text-on-surface-variant flex items-center gap-2">
                <Icon name="language" className="text-sm" /> Language
              </h3>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="glass-bubble rounded-xl p-4 text-on-surface bg-transparent focus:outline-none"
              >
                {LANGUAGES.map((l) => (
                  <option className="bg-surface-container-high" key={l} value={l}>{l}</option>
                ))}
              </select>
              <input
                className="rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 text-sm text-on-surface placeholder-outline-variant focus:outline-none focus:border-primary/40"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Objective (optional): exam prep, interview prep..."
              />
            </div>
          </div>

          {error && <div className="text-sm text-error">{error}</div>}

          <div className="mt-4 flex flex-col sm:flex-row gap-4 justify-end items-center">
            <button
              onClick={() => topic.trim() && onLearningPath({ topic: topic.trim(), profile: buildProfile() })}
              disabled={!topic.trim()}
              className="w-full sm:w-auto px-6 py-3 rounded-full glass-panel text-on-surface hover:bg-white/5 border border-outline/30 font-body-md font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Icon name="route" className="text-lg" />
              Generate Learning Path
            </button>
            <button
              onClick={handleSubmit}
              className="btn-sheen w-full sm:w-auto bg-tertiary text-on-tertiary font-headline-md text-headline-md py-4 px-10 rounded-full flex items-center gap-3 shadow-[0_0_20px_rgba(255,182,144,0.3)] hover:shadow-[0_0_30px_rgba(255,182,144,0.5)] transition-all"
            >
              <Icon name="auto_awesome" filled />
              Generate Lesson
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
