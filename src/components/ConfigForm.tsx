"use client";

import { useState } from "react";
import Icon from "./Icon";
import type { LearnerProfile, DocumentSummary } from "@/lib/types";
import { apiRequest, errorMessage } from "@/lib/http";
import { uploadDocument } from "@/lib/uploadDocument";
import { LANGUAGES } from "@/lib/languages";
import { hasVoiceFor, useVoices } from "@/hooks/useSpeech";
import { DOCUMENT_ACCEPT_ATTRIBUTE } from "@/lib/appConfig";

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
  // Restores the previous selections when the form is re-shown after a failed
  // lesson build, so a timed-out model doesn't cost the learner their setup.
  initialProfile?: LearnerProfile | null;
  onSubmit: (params: { topic: string; profile: LearnerProfile; docId?: string }) => void;
  onLearningPath: (params: { topic: string; profile: LearnerProfile }) => void;
  onBack: () => void;
}

export default function ConfigForm({
  initialTopic,
  initialDoc,
  initialProfile,
  onSubmit,
  onLearningPath,
  onBack,
}: Props) {
  const voices = useVoices();
  const [instruction, setInstruction] = useState("");
  const [parsing, setParsing] = useState(false);
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [doc, setDoc] = useState<DocumentSummary | null>(initialDoc ?? null);
  const [deleting, setDeleting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  /**
   * M10: "Remove" used to clear the local selection only, leaving the text,
   * its chunks and its embeddings in the database with no way for the learner
   * to get rid of material they had uploaded. It now deletes them.
   */
  async function handleRemoveDocument() {
    if (!doc || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await apiRequest("/api/documents", { method: "DELETE", body: { docId: doc.docId } });
      setDoc(null);
    } catch (err) {
      // The document stays selected on failure: saying "removed" when the
      // upload is still stored is the silent-failure pattern this replaced.
      setError(`Could not delete that document. ${errorMessage(err)}`);
    } finally {
      setDeleting(false);
    }
  }
  const [uploading, setUploading] = useState(false);
  const [level, setLevel] = useState<LearnerProfile["level"]>(initialProfile?.level ?? "beginner");
  const [minutes, setMinutes] = useState(initialProfile?.availableMinutes ?? 20);
  const [style, setStyle] = useState(initialProfile?.style ?? STYLES[1].value);
  const [language, setLanguage] = useState(initialProfile?.language ?? "English");
  const [objective, setObjective] = useState(initialProfile?.objective ?? "");
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
      if (!res.ok) throw new Error(data.error || "Could not parse that instruction.");
      if (data.topic) setTopic(data.topic);
      if (data.level) setLevel(data.level);
      if (data.language) setLanguage(data.language);
      if (data.availableMinutes) setMinutes(data.availableMinutes);
      if (data.objective) setObjective(data.objective);
      // A 200 that filled in nothing is still a failure from the learner's
      // point of view — say so rather than leaving the form silently unchanged.
      const filledAnything =
        data.topic || data.level || data.language || data.availableMinutes || data.objective;
      if (!filledAnything) {
        setError("Couldn't pull any settings out of that. Try naming the topic, level or language.");
      }
    } catch (err) {
      // Surface the real reason (quota exhausted, bad key, timeout). The old
      // blanket message hid account-level problems behind what looked like a
      // parsing bug, which made every failure look the same.
      const reason = (err as Error).message?.trim();
      setError(
        reason
          ? `${reason} You can still fill the fields in manually below.`
          : "Could not parse that instruction. Fill the fields in manually below."
      );
    } finally {
      setParsing(false);
    }
  }

  async function handleUploadClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = DOCUMENT_ACCEPT_ATTRIBUTE;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      setError(null);
      try {
        // H11: indexing is a durable job now; this walks it to completion and
        // shows how far it has got.
        setDoc(
          await uploadDocument(file, {
            onProgress: ({ progress }) => setUploadProgress(progress),
          })
        );
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    };
    input.click();
  }

  /** What the upload button says while a document is being indexed. */
  const uploadLabel = uploading
    ? uploadProgress > 0
      ? `Indexing ${Math.round(uploadProgress * 100)}%`
      : "Reading..."
    : null;

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
    <div className="max-w-[1400px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <button onClick={onBack} className="text-on-surface-variant hover:text-tertiary-fixed-dim text-sm flex items-center gap-1 mb-6">
        <Icon name="arrow_back" className="text-[18px]" /> Back
      </button>

      {/* Sidebar is a fixed width rather than a third of the page, and sticks
          to its own height instead of stretching: at 1/3 + h-full it grew into
          a tall mostly-empty box while squeezing the form into a narrow column. */}
      <div className="flex flex-col lg:flex-row gap-6 xl:gap-10 items-start">
        <aside className="w-full lg:w-[20rem] xl:w-[22rem] shrink-0 lg:sticky lg:top-6">
          <div className="glass-panel rounded-2xl p-6 flex flex-col gap-6 relative overflow-hidden min-h-[22rem]">
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
                {doc.conceptsWarning && (
                  <p className="text-xs text-tertiary-fixed-dim bg-tertiary/10 border border-tertiary/25 rounded-lg p-2.5">
                    {doc.conceptsWarning}
                  </p>
                )}
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
                <div className="mt-auto flex items-center gap-4">
                  <button
                    onClick={handleUploadClick}
                    disabled={uploading}
                    className="text-xs text-on-surface-variant hover:text-tertiary-fixed-dim underline disabled:opacity-50"
                  >
                    {uploadLabel ?? "Replace document"}
                  </button>
                  <button
                    onClick={handleRemoveDocument}
                    disabled={deleting}
                    className="text-xs text-on-surface-variant hover:text-error underline disabled:opacity-50"
                  >
                    {deleting ? "Deleting..." : "Delete document"}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-8">
                <Icon name="upload_file" className="text-5xl text-outline" />
                <p className="text-sm text-on-surface-variant max-w-xs">
                  No document uploaded — Aetheris will teach from general subject knowledge for this topic.
                </p>
                <button
                  onClick={handleUploadClick}
                  disabled={uploading}
                  className="px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-secondary-fixed-dim text-sm border border-white/10 disabled:opacity-50"
                >
                  {uploadLabel ?? "Upload material"}
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="w-full flex-1 min-w-0 flex flex-col gap-7">
          <div>
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

          {/* Two columns only once there is genuine room for them — at md the
              sidebar is still taking width and the pairs came out cramped. */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-7">
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
              {!hasVoiceFor(language, voices) && (
                <p className="flex items-start gap-2 text-xs text-tertiary-fixed-dim">
                  <Icon name="voice_over_off" className="text-[16px] shrink-0 mt-px" />
                  <span>
                    This device has no {language} speech voice, so the lesson will play without
                    narration. Slides, diagrams, captions and the quiz all still work. Adding a{" "}
                    {language} voice in your system&apos;s speech settings enables it.
                  </span>
                </p>
              )}
              <input
                className="rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 text-sm text-on-surface placeholder-outline-variant focus:outline-none focus:border-primary/40"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Objective (optional): exam prep, interview prep..."
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-error bg-error-container/20 border border-error/30 rounded-xl p-3.5">
              {error}
            </div>
          )}

          <div className="mt-2 flex flex-col sm:flex-row gap-4 justify-end items-center">
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
