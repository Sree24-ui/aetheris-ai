-- Durable document ingestion (H11).
--
-- Upload handling extracted the file, chunked it, embedded every chunk, wrote
-- the database and ran concept extraction inside one request with a 60-second
-- ceiling. A cold start, a large file, provider latency or the embedding model
-- initialising could exceed that, and the learner was left with no reliable
-- completion signal and a half-written document.
--
-- The work is now a row. The request accepts the file, extracts its text and
-- returns; the expensive part runs afterwards in bounded slices, each of which
-- commits its own progress. That makes it resumable: a slice that dies takes
-- at most one slice's work with it, and the next one picks up from
-- `next_chunk_index` rather than starting over.
--
-- `attempts` and `max_attempts` bound the retries so a job that cannot succeed
-- stops rather than looping; `heartbeat_at` is what lets a job abandoned
-- mid-slice be picked up again instead of being stuck as 'running' forever.

CREATE TABLE IF NOT EXISTS ingestion_jobs
(
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  -- The extracted text, held here rather than in object storage. Object
  -- storage is the production answer and needs a provider decision; the text
  -- is already bounded by the upload limits, so this is a working stand-in
  -- with the same job semantics. See docs/REMEDIATION-LEDGER.md (H11).
  extracted_text TEXT NOT NULL,
  total_chunks INTEGER NOT NULL DEFAULT 0 CHECK (total_chunks >= 0),
  -- The checkpoint: where the next slice should resume from.
  next_chunk_index INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk_index >= 0),
  concepts_done BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  /* Safe to show a learner; provider internals stay in the log. */
  error TEXT,
  heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_jobs_user_id_idx ON ingestion_jobs(user_id);
-- One job per document: re-uploading the same document cannot create a second
-- job racing the first over the same chunk rows.
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_jobs_document_id_key
  ON ingestion_jobs(document_id);
CREATE INDEX IF NOT EXISTS ingestion_jobs_pending_idx
  ON ingestion_jobs(status, updated_at)
  WHERE status IN ('queued', 'running');

-- Documents gain the ingestion state the UI shows, so "ready" is a fact about
-- the document rather than something inferred from a chunk count.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ingest_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS concepts JSONB NOT NULL DEFAULT '[]';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS preview TEXT NOT NULL DEFAULT '';
