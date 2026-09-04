import { pool } from "./db";
import {
  GENERATOR_VERSION,
  GRADER_VERSION,
  RUBRIC_VERSION,
  type GradedAnswer,
  type StoredQuestion,
} from "./grading";

/**
 * Where a quiz and its one graded attempt live (H10).
 *
 * Every read is scoped by `user_id` as well as by id, for the same reason the
 * document store is: a UUID is an identifier, not an authorisation check.
 */

export interface StoredQuiz {
  id: string;
  topic: string;
  language: string;
  questions: StoredQuestion[];
}

export interface StoredAttempt {
  quizId: string;
  results: GradedAnswer[];
  scorePercent: number;
  graderVersion: string;
  rubricVersion: string;
}

export async function saveQuiz(quiz: StoredQuiz, userId: number): Promise<void> {
  await pool.query(
    `INSERT INTO lesson_quizzes (id, user_id, topic, language, questions, generator_version)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [quiz.id, userId, quiz.topic, quiz.language, JSON.stringify(quiz.questions), GENERATOR_VERSION]
  );
}

export async function loadQuiz(quizId: string, userId: number): Promise<StoredQuiz | null> {
  const { rows } = await pool.query<{
    id: string;
    topic: string;
    language: string;
    questions: StoredQuestion[];
  }>(
    `SELECT id, topic, language, questions
       FROM lesson_quizzes
      WHERE id = $1 AND user_id = $2`,
    [quizId, userId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    topic: row.topic,
    language: row.language,
    questions: row.questions ?? [],
  };
}

export async function loadAttempt(quizId: string, userId: number): Promise<StoredAttempt | null> {
  const { rows } = await pool.query<{
    quiz_id: string;
    results: GradedAnswer[];
    score_percent: number;
    grader_version: string;
    rubric_version: string;
  }>(
    `SELECT quiz_id, results, score_percent, grader_version, rubric_version
       FROM lesson_quiz_attempts
      WHERE quiz_id = $1 AND user_id = $2`,
    [quizId, userId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    quizId: row.quiz_id,
    results: row.results ?? [],
    scorePercent: row.score_percent,
    graderVersion: row.grader_version,
    rubricVersion: row.rubric_version,
  };
}

/**
 * Records the graded attempt, once.
 *
 * The primary key on `quiz_id` is what makes submission idempotent: a
 * duplicate submission — a double click, a retry after a timeout, a stale tab
 * — returns the outcome already stored instead of grading the same answers a
 * second time and charging for a second set of model calls.
 */
export async function saveAttempt(
  attempt: StoredAttempt,
  userId: number
): Promise<{ stored: StoredAttempt; replayed: boolean }> {
  const inserted = await pool.query(
    `INSERT INTO lesson_quiz_attempts
       (quiz_id, user_id, results, score_percent, grader_version, rubric_version)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (quiz_id) DO NOTHING
     RETURNING quiz_id`,
    [
      attempt.quizId,
      userId,
      JSON.stringify(attempt.results),
      attempt.scorePercent,
      GRADER_VERSION,
      RUBRIC_VERSION,
    ]
  );
  if (inserted.rows.length > 0) return { stored: attempt, replayed: false };

  const existing = await loadAttempt(attempt.quizId, userId);
  // The quiz is owned, so an attempt row for it can only belong to its owner.
  if (!existing) throw new Error(`Attempt for quiz ${attempt.quizId} vanished between writes`);
  return { stored: existing, replayed: true };
}
