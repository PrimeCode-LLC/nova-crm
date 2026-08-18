-- P3.1: precomputed org dashboard summary table + tenant RLS.
-- Shape mirrors Firestore `orgDashboardSummaries` / `OrgDashboardSummary` (P0.3).
-- Writers (P3.2) and dashboard read cutover (P3.3) come later.

CREATE TABLE "org_dashboard_summaries" (
    "organization_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "open_sales_leads" INTEGER NOT NULL DEFAULT 0,
    "idle_sales_leads" INTEGER NOT NULL DEFAULT 0,
    "prospects" INTEGER NOT NULL DEFAULT 0,
    "prospects_need_routing" INTEGER NOT NULL DEFAULT 0,
    "prospects_ready_to_push" INTEGER NOT NULL DEFAULT 0,
    "prospects_pushed" INTEGER NOT NULL DEFAULT 0,
    "followups_due" INTEGER NOT NULL DEFAULT 0,
    "overdue_followups" INTEGER NOT NULL DEFAULT 0,
    "total_replies" INTEGER NOT NULL DEFAULT 0,
    "replies_pending_review" INTEGER NOT NULL DEFAULT 0,
    "open_pipeline_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "open_deal_count" INTEGER NOT NULL DEFAULT 0,
    "lead_estimate_contributors" INTEGER NOT NULL DEFAULT 0,
    "pipeline_by_stage" JSONB NOT NULL DEFAULT '{}',
    "channel_mix" JSONB NOT NULL DEFAULT '{}',
    "funnel_by_channel" JSONB NOT NULL DEFAULT '{}',
    "ranges" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "org_dashboard_summaries_pkey" PRIMARY KEY ("organization_id")
);

ALTER TABLE "org_dashboard_summaries"
  ADD CONSTRAINT "org_dashboard_summaries_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_dashboard_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_dashboard_summaries" FORCE ROW LEVEL SECURITY;

CREATE POLICY org_dashboard_summaries_tenant_isolation ON "org_dashboard_summaries"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));

CREATE POLICY org_dashboard_summaries_bypass_rls ON "org_dashboard_summaries"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE org_dashboard_summaries TO nova_app;
