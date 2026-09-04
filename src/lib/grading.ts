import type { QuizQuestion } from "./types";

/**
 * Assessment authority (H10).
 *
 * The generated quiz used to be handed to the browser with `correctAnswer`
 * still on it. The browser then compared the learner's text to that key and
 * posted its own verdict back, which the report and the learner's history
 * accepted. Three things were wrong with that: the key was readable in the
 * network tab, a crafted request could claim any score, and multiple-choice
 * grading was exact string equality, so "4" and "4." disagreed.
 *
 * This module owns the shapes and the deterministic half of the grading. The
 * key lives in `StoredQuestion` (server-side only); `LearnerQuestion` is the
 * projection the browser is allowed to see, and it has no key on it at all —
 * not blanked out, absent.
 */

/** Bumped when the prompts or schema that produce a quiz change. */
export const GENERATOR_VERSION = "quiz/1.0.0";
/** Bumped when grading logic changes, so old attempts stay interpretable. */
export const GRADER_VERSION = "grader/1.0.0";
/** Bumped when the short-answer rubric changes. */
export const RUBRIC_VERSION = "rubric/1.0.0";

export interface StoredOption {
  id: string;
  text: string;
}

/** A question as the server holds it — including the answer key. */
export interface StoredQuestion {
  id: string;
  type: "mcq" | "short";
  question: string;
  options?: StoredOption[];
  /** For MCQ: which option is correct. Resolved once, when the quiz is made. */
  correctOptionId?: string;
  /** For short answers: the reference answer the rubric grades against. */
  correctAnswer?: string;
  conceptTag: string;
}

/** The same question with every trace of the key removed. */
export interface LearnerQuestion {
  id: string;
  type: "mcq" | "short";
  question: string;
  options?: StoredOption[];
  conceptTag: string;
}

/** One submitted answer. MCQ answers name an option; short answers are text. */
export interface SubmittedAnswer {
  questionId: string;
  optionId?: string;
  text?: string;
}

export interface GradedAnswer {
  questionId: string;
  question: string;
  conceptTag: string;
  /** What the learner actually chose or wrote, resolved to display text. */
  studentAnswer: string;
  correct: boolean;
  /** 0–1. Deterministic grading is all-or-nothing; the rubric can be finer. */
  partialCredit: number;
  /** How the verdict was reached, so a disputed grade can be explained. */
  gradedBy: "deterministic" | "rubric" | "unanswered";
  feedback?: string;
}

/**
 * Normalises answer text for comparison.
 *
 * Only used to match the model's free-text `correctAnswer` back to one of the
 * options it also produced — never to grade a learner's answer, which is done
 * by option id. Models routinely label the answer ("B) 4", "2. four") or add a
 * trailing full stop, and none of that should decide a learner's score.
 */
export function normaliseAnswerText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[\s(]*[a-z0-9][).:]\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim();
}

/**
 * Turns a freshly generated quiz into the stored form: stable question ids,
 * stable option ids, and the correct option resolved to an id.
 *
 * A multiple-choice question whose stated answer matches none of its own
 * options is dropped. It cannot be graded fairly — every learner would be
 * marked wrong whatever they picked — and silently keeping it is how an
 * ungradeable item ends up in someone's permanent record.
 */
export function prepareQuiz(questions: QuizQuestion[]): {
  stored: StoredQuestion[];
  dropped: number;
} {
  const stored: StoredQuestion[] = [];
  let dropped = 0;

  questions.forEach((question, index) => {
    const id = `q${index + 1}`;

    if (question.type === "mcq") {
      const texts = question.options ?? [];
      if (texts.length < 2 || !question.correctAnswer) {
        dropped += 1;
        return;
      }
      const options: StoredOption[] = texts.map((text, i) => ({ id: `o${i + 1}`, text }));
      const target = normaliseAnswerText(question.correctAnswer);
      const match = options.find((option) => normaliseAnswerText(option.text) === target);
      if (!match) {
        dropped += 1;
        return;
      }
      stored.push({
        id,
        type: "mcq",
        question: question.question,
        options,
        correctOptionId: match.id,
        conceptTag: question.conceptTag,
      });
      return;
    }

    if (!question.correctAnswer) {
      // Without a reference answer the rubric has nothing to grade against.
      dropped += 1;
      return;
    }
    stored.push({
      id,
      type: "short",
      question: question.question,
      correctAnswer: question.correctAnswer,
      conceptTag: question.conceptTag,
    });
  });

  return { stored, dropped };
}

/** The projection the browser receives. The key is absent, not emptied. */
export function toLearnerQuiz(stored: StoredQuestion[]): LearnerQuestion[] {
  return stored.map(({ id, type, question, options, conceptTag }) => ({
    id,
    type,
    question,
    ...(options ? { options } : {}),
    conceptTag,
  }));
}

/**
 * Grades one multiple-choice answer.
 *
 * Comparison is by option id, so an answer is right because the learner chose
 * the right option — not because their text happened to match after
 * normalisation. An id that is not one of this question's options is treated
 * as unanswered rather than as a wrong answer to something else.
 */
export function gradeMultipleChoice(
  question: StoredQuestion,
  answer: SubmittedAnswer | undefined
): GradedAnswer {
  const chosen = question.options?.find((option) => option.id === answer?.optionId);
  if (!chosen) {
    return {
      questionId: question.id,
      question: question.question,
      conceptTag: question.conceptTag,
      studentAnswer: "",
      correct: false,
      partialCredit: 0,
      gradedBy: "unanswered",
    };
  }
  const correct = chosen.id === question.correctOptionId;
  return {
    questionId: question.id,
    question: question.question,
    conceptTag: question.conceptTag,
    studentAnswer: chosen.text,
    correct,
    partialCredit: correct ? 1 : 0,
    gradedBy: "deterministic",
  };
}

/** An answer that was never given. Recorded explicitly rather than as wrong. */
export function unanswered(question: StoredQuestion, studentAnswer = ""): GradedAnswer {
  return {
    questionId: question.id,
    question: question.question,
    conceptTag: question.conceptTag,
    studentAnswer,
    correct: false,
    partialCredit: 0,
    gradedBy: "unanswered",
  };
}

/**
 * The score for a graded attempt, as a percentage.
 *
 * Partial credit counts, so a short answer graded 0.5 contributes half a mark
 * rather than nothing. An empty quiz scores 0 rather than dividing by zero.
 */
export function scorePercent(results: GradedAnswer[]): number {
  if (results.length === 0) return 0;
  const earned = results.reduce((sum, r) => sum + Math.min(Math.max(r.partialCredit, 0), 1), 0);
  return Math.round((earned / results.length) * 1000) / 10;
}
