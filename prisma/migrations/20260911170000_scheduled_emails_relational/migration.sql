-- Relational scheduled-email queue, mailbox pacing, suppressions, email events,
-- and Contact.timezone. Partial indexes + RLS for the send hot path.

-- AlterTable: contacts.timezone
ALTER TABLE "contacts" ADD COLUMN "timezone" TEXT;

-- CreateTable: scheduled_emails
CREATE TABLE "scheduled_emails" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "mailbox_owner_uid" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "scheduled_by_user_id" TEXT,
    "followup_id" TEXT,
    "lead_id" TEXT,
    "status" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "not_before_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_kind" TEXT,
    "lease_until" TIMESTAMPTZ(3),
    "lease_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "error" TEXT,
    "last_skip_reason" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_emails_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scheduled_emails_organization_id_idx"
    ON "scheduled_emails"("organization_id");
CREATE INDEX "scheduled_emails_organization_id_mailbox_owner_uid_status_idx"
    ON "scheduled_emails"("organization_id", "mailbox_owner_uid", "status");
CREATE INDEX "scheduled_emails_mailbox_day_idx"
    ON "scheduled_emails"("organization_id", "mailbox_id", "status", "scheduled_at");

-- Hot-path: only pending rows; COALESCE so not_before_at deferrals sort correctly.
CREATE INDEX "scheduled_emails_due_idx"
    ON "scheduled_emails" (COALESCE("not_before_at", "scheduled_at"))
    WHERE "status" = 'pending';

CREATE INDEX "scheduled_emails_lease_idx"
    ON "scheduled_emails" ("lease_until")
    WHERE "status" = 'processing';

-- One active (pending/processing) row per org+idempotency_key (typically followupId).
CREATE UNIQUE INDEX "scheduled_emails_active_idem_idx"
    ON "scheduled_emails" ("organization_id", "idempotency_key")
    WHERE "status" IN ('pending', 'processing');

-- CreateTable: mailbox_send_state
CREATE TABLE "mailbox_send_state" (
    "organization_id" TEXT NOT NULL,
    "mailbox_owner_uid" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "next_available_at" TIMESTAMPTZ(3) NOT NULL,
    "last_sent_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_send_state_pkey" PRIMARY KEY ("organization_id", "mailbox_owner_uid", "mailbox_id")
);

-- CreateTable: email_suppressions
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'system',
    "lead_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_suppressions_organization_id_email_normalized_key"
    ON "email_suppressions"("organization_id", "email_normalized");
CREATE INDEX "email_suppressions_organization_id_idx"
    ON "email_suppressions"("organization_id");

-- CreateTable: email_events
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "scheduled_email_id" TEXT,
    "followup_id" TEXT,
    "lead_id" TEXT,
    "mailbox_id" TEXT,
    "message_id" TEXT,
    "recipient" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_events_organization_id_type_occurred_at_idx"
    ON "email_events"("organization_id", "type", "occurred_at");
CREATE INDEX "email_events_organization_id_scheduled_email_id_idx"
    ON "email_events"("organization_id", "scheduled_email_id");
CREATE INDEX "email_events_organization_id_lead_id_idx"
    ON "email_events"("organization_id", "lead_id");
CREATE INDEX "email_events_occurred_at_brin"
    ON "email_events" USING BRIN ("occurred_at");

-- RLS
ALTER TABLE "scheduled_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_emails" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mailbox_send_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mailbox_send_state" FORCE ROW LEVEL SECURITY;
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_suppressions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "email_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY scheduled_emails_tenant_isolation ON "scheduled_emails"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY scheduled_emails_bypass_rls ON "scheduled_emails"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY mailbox_send_state_tenant_isolation ON "mailbox_send_state"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY mailbox_send_state_bypass_rls ON "mailbox_send_state"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY email_suppressions_tenant_isolation ON "email_suppressions"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY email_suppressions_bypass_rls ON "email_suppressions"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY email_events_tenant_isolation ON "email_events"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY email_events_bypass_rls ON "email_events"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  scheduled_emails, mailbox_send_state, email_suppressions, email_events
  TO nova_app;
