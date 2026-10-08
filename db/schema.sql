-- KnowledgeDock — Esquema de base de datos
-- BD: Neon Postgres con pgvector

CREATE EXTENSION IF NOT EXISTS vector;

-- dim=768 para gemini-embedding-001. Si cambias de modelo, cambia esto.
CREATE TABLE IF NOT EXISTS documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    text NOT NULL,
  title       text NOT NULL,
  mime_type   text NOT NULL,
  storage_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id          bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord         int  NOT NULL,          -- posición en el documento
  content     text NOT NULL,
  embedding   vector(768) NOT NULL
);

-- Índice HNSW para búsquedas vectoriales rápidas (mejor recall en datasets pequeños)
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);
