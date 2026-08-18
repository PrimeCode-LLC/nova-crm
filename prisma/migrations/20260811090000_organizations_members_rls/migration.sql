-- P2.2: organizations + members tables and tenant RLS.
-- Session GUC: app.organization_id (SET LOCAL via set_config(..., true)).
-- Bypass GUC: app.bypass_rls = 'on' for platform/ETL paths only.

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "max_users" INTEGER,
    "seats_used" INTEGER NOT NULL DEFAULT 0,
    "owner_uid" TEXT,
    "primary_email" TEXT,
    "pending_owner_email" TEXT,
    "trial_ends_at" TIMESTAMPTZ(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "channel_admin" JSONB,
    "intake_filter_defaults" JSONB,
    "intake_pool_epoch" INTEGER NOT NULL DEFAULT 1,
    "intent_playbook" JSONB,
    "open_join_token_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "uid" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "invited_by_uid" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "members_pkey" PRIMARY KEY ("organization_id","uid")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "members_organization_id_idx" ON "members"("organization_id");

-- CreateIndex
CREATE INDEX "members_email_idx" ON "members"("email");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security (ENGINEERING_RULES §1 / §3)
-- FORCE so table owner (migrate role) cannot accidentally bypass in app use.
-- ---------------------------------------------------------------------------

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;

ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;

-- Tenant isolation: organizations keyed by id == app.organization_id
CREATE POLICY organizations_tenant_isolation ON "organizations"
  FOR ALL
  USING (id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (id = NULLIF(current_setting('app.organization_id', true), ''));

CREATE POLICY organizations_bypass_rls ON "organizations"
  AS PERMISSIVE
  FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

-- Tenant isolation: members keyed by organization_id
CREATE POLICY members_tenant_isolation ON "members"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));

CREATE POLICY members_bypass_rls ON "members"
  AS PERMISSIVE
  FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');
