"use client";

import { useEffect, useState } from "react";
import type { GradedAnswer, LearnerQuestion } from "@/lib/grading";
import { apiRequest, errorMessage } from "@/lib/http";
import Icon from "./Icon";

export interface QuizOutcome {
  quizId: string;
  scorePercent: number;
  results: GradedAnswer[];
}

interface Props {
  /** The lesson being assessed; the questions come from its stored plan. */
  sessionId: string;
  /** Shown in the heading only. */
  topic: string;
  language: string;
  onFinished: (outcome: QuizOutcome) => void;
}

interface GeneratedQuiz {
  quizId: string;
  questions: LearnerQuestion[];
}

/**
 * The end-of-lesson assessment.
 *
 * H10: this component used to receive the answer key along with the questions
 * and decide the marks itself — multiple choice by string equality, short
 * answers by calling the evaluator with the key in the request body. It now
 * only collects answers. The quiz id and the option ids come from the server,
 * the marks come back from the server, and nothing here can assert that an
 * answer was correct.
 */
export default function QuizPanel({ sessionId, topic, language, onFinished }: Props) {
  const [quiz, setQuiz] = useState<GeneratedQuiz | null>(null);
  /** questionId -> chosen option id (mcq) or typed text (short). */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<GeneratedQuiz>("/api/lesson/quiz", {
      method: "POST",
      body: { sessionId, language },
      signal: controller.signal,
    })
      .then((data) => {
        setQuiz(data);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  async function handleSubmit() {
    if (!quiz || grading) return;
    setGrading(true);
    setGradingError(null);
    try {
      // One request grades the whole quiz. Re-submitting the same quiz id
      // returns the stored attempt rather than grading it twice, so a double
      // click or a retry cannot produce two different marks.
      const outcome = await apiRequest<QuizOutcome>("/api/lesson/quiz/grade", {
        method: "POST",
        body: {
          quizId: quiz.quizId,
          answers: quiz.questions.map((question) =>
            question.type === "mcq"
              ? { questionId: question.id, optionId: answers[question.id] }
              : { questionId: question.id, text: answers[question.id] ?? "" }
          ),
        },
      });
      onFinished(outcome);
    } catch (err) {
      // Kept separate from `error` (which swaps in the reload-the-quiz screen)
      // so a transient grader hiccup doesn't discard everything they typed.
      setGradingError(
        `${errorMessage(err)} Your answers are safe — submitting again will not double-count them.`
      );
    } finally {
      setGrading(false);
    }
  }

  if (error)
    return (
      <div className="max-w-2xl mx-auto mt-10 space-y-4">
        <div className="text-sm text-error bg-error-container/20 border border-error/30 rounded-xl p-4">
          Could not generate the assessment: {error} This is usually a temporary hiccup from the AI
          model — your lesson progress is safe, just try again.
        </div>
        <button
          onClick={() => {
            setQuiz(null);
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

  if (!quiz)
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
        <p className="text-sm text-on-surface-variant">Preparing your assessment...</p>
      </div>
    );

  const allAnswered = quiz.questions.every((q) => (answers[q.id] || "").trim().length > 0);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5 py-4">
      <h2 className="font-display-lg-mobile text-display-lg-mobile text-on-surface flex items-center gap-3">
        <Icon name="quiz" className="text-primary-fixed-dim" filled />
        Assessment: {topic}
      </h2>
      {quiz.questions.map((q, i) => (
        <fieldset key={q.id} className="glass-panel rounded-xl p-5 space-y-3">
          <legend className="font-body-lg text-body-lg text-on-surface">
            {i + 1}. {q.question}
          </legend>
          {q.type === "mcq" && q.options ? (
            <div className="grid gap-2">
              {q.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  // The chosen option is recorded by id, which is what the
                  // server grades against — the text is only ever displayed.
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: option.id }))}
                  aria-pressed={answers[q.id] === option.id}
                  className={`text-left text-sm px-4 py-2.5 rounded-xl glass-bubble ${
                    answers[q.id] === option.id ? "active" : ""
                  }`}
                >
                  {option.text}
                </button>
              ))}
            </div>
          ) : (
            <>
              <label htmlFor={`answer-${q.id}`} className="sr-only">
                Your answer to question {i + 1}
              </label>
              <textarea
                id={`answer-${q.id}`}
                className="w-full rounded-xl border border-white/10 bg-surface-container/50 px-4 py-3 text-sm text-on-surface placeholder-outline-variant focus:outline-none focus:border-primary/40"
                rows={2}
                value={answers[q.id] || ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            </>
          )}
        </fieldset>
      ))}
      {gradingError && (
        <div role="alert" className="text-sm text-error bg-error-container/20 border border-error/30 rounded-xl p-3">
          {gradingError}
        </div>
      )}
      {!allAnswered && (
        <p className="text-xs text-on-surface-variant text-center">
          Answer all {quiz.questions.length} questions to submit.
        </p>
      )}
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
