-- Durable lesson sessions (H8, H10, and the refresh-and-resume gap).
--
-- The lesson in progress lived entirely in browser state. Refreshing lost it,
-- signing in on another device could not see it, the full plan — checkpoint
-- answer keys included — was shipped to the client, and completion was
-- several independent requests whose partial failure left progress in a state
-- nobody could reconstruct.
--
-- `plan` holds the generated lesson exactly as the model produced it,
-- including checkpoint answers, and is never serialised to a client; the
-- browser receives a projection with those removed.
--
-- `version` is the optimistic-concurrency token. Every command names the
-- version it expected to act on, so a duplicate, delayed or out-of-order
-- command from a stale tab is a no-op rather than a state change.

CREATE TABLE IF NOT EXISTS lesson_sessions
(
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  topic TEXT NOT NULL,
  language TEXT NOT NULL,
  profile JSONB NOT NULL,
  plan JSONB NOT NULL,
  -- Which learning-path step this lesson belongs to, if any. Completion may
  -- only advance the path when both are set, which is what stopped an
  -- unrelated lesson pushing a curriculum forward.
  path_topic TEXT,
  path_step_index INTEGER CHECK (path_step_index IS NULL OR path_step_index >= 0),
  current_section_index INTEGER NOT NULL DEFAULT 0 CHECK (current_section_index >= 0),
  -- Server-graded checkpoint outcomes, accumulated as the lesson runs.
  checkpoint_results JSONB NOT NULL DEFAULT '[]',
  transcript JSONB NOT NULL DEFAULT '[]',
  quiz_id UUID REFERENCES lesson_quizzes(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_sessions_user_id_idx ON lesson_sessions(user_id);

-- At most one lesson in flight per learner. Starting a new one requires
-- finishing or cancelling the old one, so "resume" is never ambiguous and two
-- tabs cannot each believe they own the lesson.
CREATE UNIQUE INDEX IF NOT EXISTS lesson_sessions_one_active_per_user
  ON lesson_sessions(user_id)
  WHERE status IN ('active', 'paused');
