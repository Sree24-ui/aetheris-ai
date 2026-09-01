"use client";

import { useEffect, useState } from "react";
import Icon from "./Icon";
import { loadMemory } from "@/lib/memory";
import type { DocumentSummary, LearnerMemory } from "@/lib/types";

const EMPTY_MEMORY: LearnerMemory = { history: [], weakConcepts: [], strongConcepts: [] };

const POPULAR_TOPICS = [
  { title: "Newton's Laws of Motion", icon: "rocket_launch" },
  { title: "Photosynthesis", icon: "eco" },
  { title: "Machine Learning Basics", icon: "psychology" },
  { title: "Python Functions", icon: "code" },
  { title: "World War II Timeline", icon: "history_edu" },
  { title: "Supply and Demand", icon: "trending_up" },
];

interface Props {
  onProceed: (params: { topic: string; doc?: DocumentSummary }) => void;
  onRevise: (topic: string) => void;
}

export default function HomeDashboard({ onProceed, onRevise }: Props) {
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [memory, setMemory] = useState<LearnerMemory>(EMPTY_MEMORY);

  useEffect(() => {
    // localStorage is unavailable during SSR; reading it here (rather than
    // in the initial state) keeps the first client render matching the
    // server-rendered HTML and avoids a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemory(loadMemory());
  }, []);

  async function handleUploadClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.pptx,.txt,.md";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      setUploadError(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        onProceed({ topic: query.trim() || data.filename, doc: data });
      } catch (err) {
        setUploadError((err as Error).message);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  const avgScore =
    memory.history.length > 0
      ? Math.round(
          memory.history.reduce((sum, h) => sum + (h.scorePercent ?? 0), 0) / memory.history.length
        )
      : 0;
  const conceptCount = new Set([...memory.weakConcepts, ...memory.strongConcepts]).size;

  return (
    <div className="p-container-padding lg:p-8 min-h-screen w-full max-w-7xl mx-auto space-y-12">
      <section className="glass-panel rounded-[2rem] p-8 lg:p-12 relative overflow-hidden flex flex-col items-center justify-center text-center mt-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <h2 className="font-display-lg text-display-lg-mobile md:text-display-lg mb-6 relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-on-surface via-primary-fixed-dim to-on-surface">
          What would you like to learn today?
        </h2>
        <div className="w-full max-w-2xl relative z-10 group">
          <div className="flex flex-col sm:flex-row items-stretch gap-4 p-2 bg-surface-container/50 backdrop-blur-md rounded-2xl border border-white/10 transition-all duration-300 group-hover:border-primary/30">
            <div className="flex-1 flex items-center px-4">
              <Icon name="search" className="text-outline mr-3" />
              <input
                className="w-full bg-transparent border-none text-on-surface font-body-lg text-body-lg placeholder-outline-variant focus:ring-0 focus:outline-none px-0"
                placeholder="Enter a topic, e.g. Newton's Laws of Motion..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim()) onProceed({ topic: query.trim() });
                }}
              />
            </div>
            <div className="hidden sm:block w-px bg-white/10 my-2" />
            <button
              onClick={handleUploadClick}
              disabled={uploading}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-secondary-fixed-dim font-body-md text-body-md transition-colors whitespace-nowrap border border-transparent hover:border-secondary/20 disabled:opacity-50"
            >
              <Icon name="upload_file" className="text-[20px]" />
              {uploading ? "Processing..." : "Upload Notes"}
            </button>
            <button
              onClick={() => query.trim() && onProceed({ topic: query.trim() })}
              disabled={!query.trim()}
              className="flex items-center justify-center p-3 sm:px-6 bg-gradient-to-r from-primary-container to-inverse-primary rounded-xl text-on-primary font-body-md text-body-md font-semibold hover:opacity-90 transition-opacity whitespace-nowrap disabled:opacity-40"
            >
              <span className="hidden sm:inline">Ask AI</span>
              <Icon name="send" className="sm:hidden" />
            </button>
          </div>
          {uploadError && <p className="text-error text-sm mt-3 text-left">{uploadError}</p>}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          {memory.history.length > 0 && (
            <section>
              <div className="flex justify-between items-end mb-6">
                <h3 className="font-headline-md text-headline-md text-on-surface">Continue Learning</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {memory.history.slice(0, 4).map((h, i) => (
                  <button
                    key={i}
                    onClick={() => onProceed({ topic: h.topic })}
                    className={`text-left glass-panel rounded-2xl p-6 glow-hover transition-all duration-300 cursor-pointer group ${
                      i % 2 === 0 ? "animate-float" : "animate-float-delayed"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 rounded-xl bg-secondary-container/20 flex items-center justify-center text-secondary">
                        <Icon name="menu_book" className="text-[28px]" />
                      </div>
                      {h.scorePercent !== undefined && (
                        <span className="bg-surface-container-high px-3 py-1 rounded-full font-label-caps text-label-caps text-outline text-[10px]">
                          {Math.round(h.scorePercent)}% SCORE
                        </span>
                      )}
                    </div>
                    <h4 className="font-headline-md text-[20px] font-semibold mb-2 group-hover:text-primary-fixed-dim transition-colors line-clamp-1">
                      {h.topic}
                    </h4>
                    <p className="font-body-md text-body-md text-on-surface-variant text-sm">
                      {new Date(h.date).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="pt-2">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-6">Popular Topics</h3>
            <div className="flex gap-4 overflow-x-auto pb-4 snap-x hide-scrollbar">
              {POPULAR_TOPICS.map((t) => (
                <button
                  key={t.title}
                  onClick={() => onProceed({ topic: t.title })}
                  className="flex-none w-[200px] glass-panel rounded-2xl p-5 snap-start group hover:border-primary/30 transition-all cursor-pointer text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary-container/20 flex items-center justify-center text-primary-fixed-dim mb-4">
                    <Icon name={t.icon} className="text-[24px]" />
                  </div>
                  <h4 className="font-body-lg text-body-lg font-semibold group-hover:text-primary-fixed-dim transition-colors">
                    {t.title}
                  </h4>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="lg:col-span-4 space-y-8">
          <section className="glass-panel rounded-3xl p-6 relative overflow-hidden">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-6 relative z-10">Your Fluidity</h3>
            <div className="flex flex-col items-center justify-center py-4 relative z-10 min-h-[220px]">
              <div className="relative flex items-center justify-center z-10 mb-4">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                <div className="w-32 h-32 rounded-full glass-panel flex flex-col items-center justify-center border-primary/40 shadow-[inset_0_0_20px_rgba(208,188,255,0.2)]">
                  <span className="font-display-lg text-[40px] font-bold text-primary-fixed-dim">
                    {avgScore}
                    <span className="text-[20px]">%</span>
                  </span>
                  <span className="font-label-caps text-label-caps text-outline text-[10px]">AVG SCORE</span>
                </div>
              </div>
              <div className="flex gap-12 mt-2 z-10">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-14 h-14 rounded-full glass-panel flex items-center justify-center border-secondary/30">
                    <span className="font-body-lg text-body-lg font-semibold text-secondary-fixed-dim">
                      {memory.history.length}
                    </span>
                  </div>
                  <span className="font-label-caps text-label-caps text-outline text-[9px]">SESSIONS</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-14 h-14 rounded-full glass-panel flex items-center justify-center border-tertiary/30">
                    <span className="font-body-lg text-body-lg font-semibold text-tertiary-fixed-dim">
                      {conceptCount}
                    </span>
                  </div>
                  <span className="font-label-caps text-label-caps text-outline text-[9px]">CONCEPTS</span>
                </div>
              </div>
            </div>
          </section>

          {memory.weakConcepts.length > 0 && (
            <section className="glass-panel rounded-3xl p-6">
              <h3 className="font-headline-md text-[20px] text-on-surface mb-4">Revisit These</h3>
              <ul className="space-y-2">
                {memory.weakConcepts.slice(0, 5).map((c) => (
                  <li key={c}>
                    <button
                      onClick={() => onRevise(c)}
                      className="w-full flex gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-white/5 items-center text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-tertiary-fixed-dim flex-shrink-0">
                        <Icon name="flag" className="text-[18px]" />
                      </div>
                      <span className="font-body-md text-body-md text-on-surface line-clamp-1">{c}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
