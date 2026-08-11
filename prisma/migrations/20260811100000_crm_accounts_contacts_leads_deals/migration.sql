-- P2.6–P2.9: accounts, contacts, leads, deals + tenant RLS + nova_app grants.

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "website" TEXT,
    "owner_id" TEXT NOT NULL,
    "contact_count" INTEGER NOT NULL DEFAULT 0,
    "lead_count" INTEGER NOT NULL DEFAULT 0,
    "open_deal_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "owner_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "temperature" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "intake_kind" TEXT,
    "touches" INTEGER NOT NULL DEFAULT 0,
    "is_idle" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "probability" INTEGER NOT NULL,
    "expected_close_date" TIMESTAMPTZ(3) NOT NULL,
    "owner_id" TEXT NOT NULL,
    "won_at" TIMESTAMPTZ(3),
    "lost_at" TIMESTAMPTZ(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounts_organization_id_idx" ON "accounts"("organization_id");
CREATE INDEX "accounts_organization_id_owner_id_idx" ON "accounts"("organization_id", "owner_id");
CREATE INDEX "contacts_organization_id_idx" ON "contacts"("organization_id");
CREATE INDEX "contacts_organization_id_account_id_idx" ON "contacts"("organization_id", "account_id");
CREATE INDEX "contacts_organization_id_email_idx" ON "contacts"("organization_id", "email");
CREATE INDEX "leads_organization_id_idx" ON "leads"("organization_id");
CREATE INDEX "leads_organization_id_stage_idx" ON "leads"("organization_id", "stage");
CREATE INDEX "leads_organization_id_owner_id_idx" ON "leads"("organization_id", "owner_id");
CREATE INDEX "leads_organization_id_account_id_idx" ON "leads"("organization_id", "account_id");
CREATE INDEX "deals_organization_id_idx" ON "deals"("organization_id");
CREATE INDEX "deals_organization_id_stage_idx" ON "deals"("organization_id", "stage");
CREATE INDEX "deals_organization_id_lead_id_idx" ON "deals"("organization_id", "lead_id");

-- RLS
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_tenant_isolation ON "accounts"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY accounts_bypass_rls ON "accounts"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY contacts_tenant_isolation ON "contacts"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY contacts_bypass_rls ON "contacts"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY leads_tenant_isolation ON "leads"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY leads_bypass_rls ON "leads"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY deals_tenant_isolation ON "deals"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY deals_bypass_rls ON "deals"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE accounts, contacts, leads, deals TO nova_app;
