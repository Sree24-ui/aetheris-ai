-- Auth.js (NextAuth) schema for the @auth/pg-adapter, plus a `password`
-- column on `users` for the credentials (email + password) provider.
-- Run once against the project's Postgres database (see db/migrate.mjs).

CREATE TABLE IF NOT EXISTS verification_token
(
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS users
(
  id SERIAL,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image TEXT,
  password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- CREATE TABLE IF NOT EXISTS is a no-op on an already-existing users table,
-- so this backfills the column for databases created before it was added.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS accounts
(
  id SERIAL,
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS sessions
(
  id SERIAL,
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts("userId");
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions("userId");

-- Learner history: one row per completed lesson, scoped to the owning user.
-- Weak/strong concepts are intentionally NOT stored redundantly here — they
-- are derived on read by merging every entry's strong_areas/weak_areas for
-- that user (see src/lib/serverMemory.ts), so there is a single source of
-- truth and nothing to keep in sync.
CREATE TABLE IF NOT EXISTS learner_history_entries
(
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  language TEXT,
  subject TEXT,
  score_percent REAL,
  strong_areas JSONB NOT NULL DEFAULT '[]',
  weak_areas JSONB NOT NULL DEFAULT '[]',
  recommendation TEXT,
  transcript JSONB NOT NULL DEFAULT '[]',
  quiz JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learner_history_user_id_idx ON learner_history_entries(user_id);

-- At most one active AI-generated learning path per user.
CREATE TABLE IF NOT EXISTS learner_learning_path
(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  path JSONB NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uploaded source material. Previously these lived as JSON files on disk,
-- which on serverless meant os.tmpdir(): per-instance and ephemeral, so an
-- upload handled by one instance was invisible to the instance that later
-- planned the lesson. Storing them here makes retrieval durable and shared,
-- and scoping by user_id stops one learner reading another's document by
-- guessing a UUID.
CREATE TABLE IF NOT EXISTS documents
(
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  num_chunks INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);

-- Embeddings are stored as JSONB rather than a pgvector column so the schema
-- applies on any Postgres without an extension step. Similarity is computed
-- in Node over one document's chunks, which is a few hundred rows at most.
-- Moving to pgvector is a drop-in optimisation once corpora get large.
CREATE TABLE IF NOT EXISTS document_chunks
(
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding JSONB NOT NULL,
  PRIMARY KEY (document_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx ON document_chunks(document_id);
