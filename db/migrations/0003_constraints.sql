-- Bounds the schema can enforce for itself (M15).
--
-- Every constraint here is added NOT VALID on purpose. That applies it to
-- every new and updated row immediately, without scanning — or rejecting —
-- rows that already exist. Any pre-existing row that violates one is a data
-- problem to look at deliberately, not something a migration should decide by
-- refusing to run.
--
-- To enforce them retroactively once the existing rows are known to be clean:
--   ALTER TABLE <table> VALIDATE CONSTRAINT <name>;
-- That takes a SHARE UPDATE EXCLUSIVE lock and can run online.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learner_history_score_range') THEN
    ALTER TABLE learner_history_entries
      ADD CONSTRAINT learner_history_score_range
      CHECK (score_percent IS NULL OR (score_percent >= 0 AND score_percent <= 100)) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learner_history_topic_not_blank') THEN
    ALTER TABLE learner_history_entries
      ADD CONSTRAINT learner_history_topic_not_blank
      CHECK (length(btrim(topic)) > 0) NOT VALID;
  END IF;

  -- The audit found the path index could be advanced to the step *count*
  -- rather than the last index. The application clamps it now; this stops any
  -- other writer putting a negative value there.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learner_path_index_non_negative') THEN
    ALTER TABLE learner_learning_path
      ADD CONSTRAINT learner_path_index_non_negative
      CHECK (current_step_index >= 0) NOT VALID;
  END IF;

  -- A path with no steps cannot be resumed and cannot be advanced.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learner_path_has_steps') THEN
    ALTER TABLE learner_learning_path
      ADD CONSTRAINT learner_path_has_steps
      CHECK (jsonb_array_length(path -> 'steps') > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_filename_not_blank') THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_filename_not_blank
      CHECK (length(btrim(filename)) > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_num_chunks_non_negative') THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_num_chunks_non_negative
      CHECK (num_chunks >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_attempt_score_range') THEN
    ALTER TABLE lesson_quiz_attempts
      ADD CONSTRAINT quiz_attempt_score_range
      CHECK (score_percent >= 0 AND score_percent <= 100) NOT VALID;
  END IF;
END
$$;
