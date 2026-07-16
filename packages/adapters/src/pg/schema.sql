-- PlainSheet schema: one store for both retrieval modes.
-- pgvector for similarity, tsvector for lexical (BM25-style ranking via ts_rank_cd).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sheets (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  study_name  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sections (
  id        text PRIMARY KEY,
  sheet_id  text NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  idx       int  NOT NULL,
  heading   text NOT NULL,
  body      text NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id               text PRIMARY KEY,
  sheet_id         text NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  section_id       text NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  section_heading  text NOT NULL,
  idx              int  NOT NULL,
  body             text NOT NULL,
  -- all-MiniLM-L6-v2 embedding dimension
  embedding        vector(384),
  lexeme           tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED
);

CREATE INDEX IF NOT EXISTS chunks_lexeme_idx ON chunks USING gin (lexeme);
CREATE INDEX IF NOT EXISTS chunks_sheet_idx ON chunks (sheet_id);
-- ivfflat needs data before it helps; at demo scale a sequential scan is fine.
-- CREATE INDEX chunks_embedding_idx ON chunks USING ivfflat (embedding vector_cosine_ops);
