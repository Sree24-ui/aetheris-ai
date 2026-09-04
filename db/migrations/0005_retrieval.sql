-- Retrieval provenance and hybrid search (M3, M5, M6).
--
-- Three problems, all in the same table.
--
-- `source`: chunks carried no record of where in the document they came from,
-- so a generated claim could not be traced back to a slide or a page. The
-- chunker now derives one; this is where it is kept.
--
-- `embedding_model`: every vector was compared against every other, with
-- nothing recording which model produced it. Changing the embedding model —
-- which the audit recommends, since the current one is English-oriented while
-- the product advertises 22 languages — would silently start comparing
-- vectors from two different models, which is meaningless arithmetic that
-- returns confident nonsense. Retrieval now filters on this column, so a
-- model change degrades to "no results from old documents" rather than to
-- wrong results.
--
-- The GIN index backs the lexical half of hybrid retrieval. It uses the
-- 'simple' configuration rather than 'english' on purpose: 'english' applies
-- English stemming and an English stop-word list, which actively harms every
-- other language the product teaches in.

ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT;

CREATE INDEX IF NOT EXISTS document_chunks_text_search_idx
  ON document_chunks USING GIN (to_tsvector('simple', text));

-- Which passages grounded a lesson, so a claim in it can be traced to the
-- source material it came from.
ALTER TABLE lesson_sessions ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]';
