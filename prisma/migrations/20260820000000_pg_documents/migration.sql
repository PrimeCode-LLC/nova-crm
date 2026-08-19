-- P7: Generic document store replacing Firestore collections + org subcollections.
-- CRM entities also live in dedicated tables; pg_documents holds all other collections.

CREATE TABLE "pg_documents" (
    "path" TEXT NOT NULL,
    "organization_id" TEXT,
    "collection_root" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pg_documents_pkey" PRIMARY KEY ("path")
);

CREATE INDEX "pg_documents_organization_id_collection_root_idx"
    ON "pg_documents"("organization_id", "collection_root");
CREATE INDEX "pg_documents_collection_root_idx"
    ON "pg_documents"("collection_root");
CREATE INDEX "pg_documents_payload_gin_idx"
    ON "pg_documents" USING GIN ("payload");

ALTER TABLE "pg_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pg_documents" FORCE ROW LEVEL SECURITY;

CREATE POLICY pg_documents_tenant_isolation ON "pg_documents"
  FOR ALL
  USING (
    organization_id IS NULL
    OR organization_id = NULLIF(current_setting('app.organization_id', true), '')
  )
  WITH CHECK (
    organization_id IS NULL
    OR organization_id = NULLIF(current_setting('app.organization_id', true), '')
  );

CREATE POLICY pg_documents_bypass_rls ON "pg_documents"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pg_documents TO nova_app;

-- Org invites (normalized for token accept flow)
CREATE TABLE "org_invites" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_uid" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_uid" TEXT,

    CONSTRAINT "org_invites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org_invites_organization_id_idx" ON "org_invites"("organization_id");
CREATE INDEX "org_invites_token_hash_idx" ON "org_invites"("token_hash");

ALTER TABLE "org_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_invites" FORCE ROW LEVEL SECURITY;

CREATE POLICY org_invites_tenant_isolation ON "org_invites"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY org_invites_bypass_rls ON "org_invites"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE org_invites TO nova_app;
