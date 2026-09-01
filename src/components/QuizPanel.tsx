"use client";

import { useEffect, useState } from "react";
import type { LessonPlan, QuizQuestion } from "@/lib/types";
import Icon from "./Icon";

interface Props {
  lessonPlan: LessonPlan;
  language: string;
  onFinished: (results: { question: QuizQuestion; studentAnswer: string; correct: boolean }[]) => void;
}

export default function QuizPanel({ lessonPlan, language, onFinished }: Props) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lesson/quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonPlan, language }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (!cancelled) {
          setQuestions(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  async function handleSubmit() {
    if (!questions) return;
    setGrading(true);
    const results: { question: QuizQuestion; studentAnswer: string; correct: boolean }[] = [];
    for (const q of questions) {
      const studentAnswer = answers[q.id] || "";
      if (q.type === "mcq") {
        const correct =
          studentAnswer.trim().toLowerCase() === (q.correctAnswer || "").trim().toLowerCase();
        results.push({ question: q, studentAnswer, correct });
      } else {
        try {
          const res = await fetch("/api/lesson/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: { id: q.id, type: "short", question: q.question, correctAnswer: q.correctAnswer, conceptTag: q.conceptTag },
              studentAnswer,
              sectionContext: lessonPlan.topic,
              language,
            }),
          });
          const evalResult = await res.json();
          results.push({ question: q, studentAnswer, correct: !!evalResult.correct });
        } catch {
          results.push({ question: q, studentAnswer, correct: false });
        }
      }
    }
    setGrading(false);
    onFinished(results);
  }

  if (error)
    return (
      <div className="max-w-2xl mx-auto mt-10 space-y-4">
        <div className="text-sm text-error bg-error-container/20 border border-error/30 rounded-xl p-4">
          Could not generate the assessment: {error}. This is usually a temporary hiccup from the AI
          model — your lesson progress is safe, just try again.
        </div>
        <button
          onClick={() => {
            setQuestions(null);
            setError(null);
            setLoadAttempt((n) => n + 1);
          }}
          className="btn-sheen w-full px-4 py-3 rounded-full bg-primary-container text-on-primary-container font-semibold flex items-center justify-center gap-2"
        >
          <Icon name="refresh" className="text-lg" />
          Retry
        </button>
      </div>
    );
  if (!questions)
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
        <p className="text-sm text-on-surface-variant">Preparing your assessment...</p>
      </div>
    );

  const allAnswered = questions.every((q) => (answers[q.id] || "").trim().length > 0);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5 py-4">
      <h2 className="font-display-lg-mobile text-display-lg-mobile text-on-surface flex items-center gap-3">
        <Icon name="quiz" className="text-primary-fixed-dim" filled />
        Assessment: {lessonPlan.topic}
      </h2>
      {questions.map((q, i) => (
        <div key={q.id} className="glass-panel rounded-xl p-5 space-y-3">
          <div className="font-body-lg text-body-lg text-on-surface">{i + 1}. {q.question}</div>
          {q.type === "mcq" && q.options ? (
            <div className="grid gap-2">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                  className={`text-left text-sm px-4 py-2.5 rounded-xl glass-bubble ${
                    answers[q.id] === opt ? "active" : ""
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              className="w-full rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 text-sm text-on-surface placeholder-outline-variant focus:outline-none focus:border-primary/40"
              rows={2}
              value={answers[q.id] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={!allAnswered || grading}
        className="btn-sheen w-full px-4 py-4 rounded-full bg-primary-container text-on-primary-container font-headline-md text-[18px] font-semibold disabled:opacity-40 shadow-[0_0_20px_rgba(160,120,255,0.3)]"
      >
        {grading ? "Grading..." : "Submit assessment"}
      </button>
    </div>
  );
}
