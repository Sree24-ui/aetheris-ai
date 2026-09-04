"use client";

import { useEffect, useState } from "react";
import { loadMemory } from "@/lib/memory";
import { errorMessage } from "@/lib/http";
import type { LearnerMemory } from "@/lib/types";
import Icon from "./Icon";

const EMPTY_MEMORY: LearnerMemory = { history: [], weakConcepts: [], strongConcepts: [] };

export default function LearnerDashboard({ onClose }: { onClose: () => void }) {
  const [memory, setMemory] = useState<LearnerMemory>(EMPTY_MEMORY);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The retry button, not the effect, resets the loading/error state — React
  // forbids a synchronous setState in an effect body.
  const retry = () => {
    setLoading(true);
    setError(null);
    setReloadKey((n) => n + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    loadMemory(controller.signal)
      .then((m) => {
        setMemory(m);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // H7: a failed load used to leave the spinner's empty state on screen,
        // which reads as "you have never completed a lesson".
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  // M2: `history` is the most recent window, not the whole account. Saying so
  // keeps a windowed list from being read as a lifetime record.
  const total = memory.historyTotal ?? memory.history.length;
  const truncated = total > memory.history.length;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 py-4">
      <button onClick={onClose} className="text-on-surface-variant hover:text-tertiary-fixed-dim text-sm flex items-center gap-1">
        <Icon name="arrow_back" className="text-[18px]" /> Back
      </button>
      <h2 className="font-display-lg-mobile text-display-lg-mobile text-on-surface">Your learning profile</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="glass-panel rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3 text-secondary-fixed">
            <Icon name="check_circle" className="text-xl" />
            <h4 className="font-label-caps text-label-caps">Strong Concepts</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {memory.strongConcepts.length > 0 ? (
              memory.strongConcepts.slice(0, 12).map((c) => (
                <span key={c} className="px-3 py-1 bg-secondary/10 text-secondary-fixed-dim text-sm rounded-full border border-secondary/20">
                  {c}
                </span>
              ))
            ) : (
              <span className="text-on-surface-variant text-sm">None yet</span>
            )}
          </div>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3 text-tertiary-fixed-dim">
            <Icon name="flag" className="text-xl" />
            <h4 className="font-label-caps text-label-caps">Weak Concepts</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {memory.weakConcepts.length > 0 ? (
              memory.weakConcepts.slice(0, 12).map((c) => (
                <span key={c} className="px-3 py-1 bg-tertiary/10 text-tertiary-fixed-dim text-sm rounded-full border border-tertiary/20">
                  {c}
                </span>
              ))
            ) : (
              <span className="text-on-surface-variant text-sm">None yet</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-headline-md text-[18px] text-on-surface mb-3 flex items-center gap-2">
          <Icon name="history" className="text-primary-fixed-dim" />
          History
          {total > 0 && (
            <span className="font-body-md text-sm text-on-surface-variant font-normal">
              {truncated
                ? `showing the ${memory.history.length} most recent of ${total} lessons`
                : `${total} ${total === 1 ? "lesson" : "lessons"}`}
            </span>
          )}
        </h3>
        <div className="space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-on-surface-variant">
              <span className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              Loading your history...
            </div>
          )}
          {error && (
            <div className="text-sm text-error bg-error-container/20 border border-error/30 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <span>Could not load your history: {error}</span>
              <button
                onClick={retry}
                className="px-3 py-1.5 rounded-full bg-error-container/40 border border-error/40 text-xs font-medium whitespace-nowrap"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && memory.history.length === 0 && (
            <div className="text-sm text-on-surface-variant">No lessons completed yet.</div>
          )}
          {memory.history.map((h, i) => {
            const key = h.id ?? String(i);
            const isOpen = expanded === key;
            // Entries saved before transcripts were introduced won't have
            // these fields — fall back gracefully instead of crashing.
            const transcript = h.transcript ?? [];
            const quiz = h.quiz ?? [];
            const hasDetail = transcript.length > 0 || quiz.length > 0;

            return (
              <div key={key} className="glass-panel rounded-xl overflow-hidden">
                <button
                  onClick={() => hasDetail && setExpanded(isOpen ? null : key)}
                  className={`w-full p-4 flex items-center justify-between text-left ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
                >
                  <div className="min-w-0">
                    <div className="font-body-md text-body-md text-on-surface font-medium truncate">{h.topic}</div>
                    <div className="text-xs text-on-surface-variant flex items-center gap-2 mt-0.5">
                      <span>{new Date(h.date).toLocaleString()}</span>
                      {h.language && <span className="opacity-60">· {h.language}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    {h.scorePercent !== undefined && (
                      <div className="text-primary-fixed-dim font-headline-md text-[18px]">
                        {Math.round(h.scorePercent)}%
                      </div>
                    )}
                    {hasDetail && (
                      <Icon name={isOpen ? "expand_less" : "expand_more"} className="text-on-surface-variant" />
                    )}
                  </div>
                </button>

                {isOpen && hasDetail && (
                  <div className="border-t border-white/10 p-4 space-y-4 bg-surface-container-lowest/30">
                    {h.recommendation && (
                      <p className="text-sm text-on-surface-variant italic">{h.recommendation}</p>
                    )}

                    {transcript.length > 0 && (
                      <div>
                        <h5 className="font-label-caps text-label-caps text-on-surface-variant mb-2">Lesson conversation</h5>
                        <div className="max-h-72 overflow-y-auto flex flex-col gap-2 pr-1">
                          {transcript.map((m, mi) => (
                            <div
                              key={mi}
                              className={`rounded-lg px-3 py-2 text-xs whitespace-pre-line max-w-[90%] ${
                                m.role === "ai"
                                  ? "bg-primary-container/10 border border-primary/20 self-start text-on-surface"
                                  : "bg-secondary-container/20 border border-secondary/20 self-end text-secondary-fixed"
                              }`}
                            >
                              {m.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {quiz.length > 0 && (
                      <div>
                        <h5 className="font-label-caps text-label-caps text-on-surface-variant mb-2">Assessment answers</h5>
                        <div className="space-y-1.5">
                          {quiz.map((q, qi) => (
                            <div key={qi} className="text-xs flex items-start gap-2">
                              <Icon
                                name={q.correct ? "check_circle" : "cancel"}
                                className={`text-[16px] shrink-0 mt-0.5 ${q.correct ? "text-secondary" : "text-error"}`}
                              />
                              <div>
                                <div className="text-on-surface">{q.question}</div>
                                <div className="text-on-surface-variant">Answered: {q.studentAnswer || "—"}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
