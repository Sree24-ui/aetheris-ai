-- Server-owned assessment (H10).
--
-- The generated quiz used to be returned to the browser with its
-- `correctAnswer` field intact, and the browser then decided which answers
-- were right and posted that verdict back. A learner could read the key out of
-- the network tab, and a crafted request could claim any score it liked.
--
-- The quiz now lives here. `questions` holds the full generated quiz including
-- the answer key and is never serialised to a client; the browser receives a
-- projection with the key removed. Grading happens on the server against this
-- row.

CREATE TABLE IF NOT EXISTS lesson_quizzes
(
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  language TEXT NOT NULL,
  -- Stable question and option identifiers are assigned when the row is
  -- written, so grading compares ids rather than answer text.
  questions JSONB NOT NULL,
  -- Which prompt/schema produced this quiz, so a later change is traceable.
  generator_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_quizzes_user_id_idx ON lesson_quizzes(user_id);

-- One graded attempt per quiz. The primary key on quiz_id is what makes
-- submission idempotent: a duplicate or retried submission returns the stored
-- outcome instead of grading (and charging for) the same answers twice.
CREATE TABLE IF NOT EXISTS lesson_quiz_attempts
(
  quiz_id UUID PRIMARY KEY REFERENCES lesson_quizzes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Per-question verdict plus the evidence behind it: what the learner
  -- answered, how it was graded, and why.
  results JSONB NOT NULL,
  score_percent REAL NOT NULL,
  grader_version TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  graded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_quiz_attempts_user_id_idx ON lesson_quiz_attempts(user_id);
