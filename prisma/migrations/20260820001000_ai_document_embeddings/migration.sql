-- P7.6: AI document embeddings (requires pgvector — Compose image pgvector/pgvector:pg16).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "ai_document_embeddings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',
    "embedding" vector(1536),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_document_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_document_embeddings_org_library_idx"
    ON "ai_document_embeddings"("organization_id", "library_id");

ALTER TABLE "ai_document_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_document_embeddings" FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_document_embeddings_tenant ON "ai_document_embeddings"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY ai_document_embeddings_bypass ON "ai_document_embeddings"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_document_embeddings TO nova_app;
