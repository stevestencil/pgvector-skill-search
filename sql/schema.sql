-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Create skill_documents table
CREATE TABLE "skill_documents" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "collection"   TEXT NOT NULL,
  "skill_name"   TEXT NOT NULL,
  "title"        TEXT,
  "content"      TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "embedding"    vector(1024),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_documents_pkey" PRIMARY KEY ("id")
);

-- Generated tsvector column for BM25 full-text search
-- NOT in Prisma model — Prisma must never write to this column
ALTER TABLE "skill_documents"
  ADD COLUMN "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

-- Unique constraint: one skill per (collection, skill_name)
CREATE UNIQUE INDEX "skill_documents_collection_skill_name_key"
  ON "skill_documents"("collection", "skill_name");

-- Index for filtering by collection
CREATE INDEX "skill_documents_collection_idx"
  ON "skill_documents"("collection");

-- GIN index for BM25 full-text search
CREATE INDEX "skill_documents_content_tsv_idx"
  ON "skill_documents" USING GIN ("content_tsv");

-- HNSW index for vector similarity search
-- m=16, ef_construction=64 are good defaults for a small-to-medium corpus
-- No minimum row count required (unlike IVFFlat)
CREATE INDEX "skill_documents_embedding_idx"
  ON "skill_documents" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
