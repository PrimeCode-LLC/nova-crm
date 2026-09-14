-- Outreach eval loop: configs, provenance, eval, experiments, scorecards.

CREATE TABLE "outreach_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "user_prompt_template" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "script_id" TEXT,
    "rag_mode" TEXT,
    "rag_library_ids" JSONB NOT NULL DEFAULT '[]',
    "sequence_mode" TEXT,
    "channel_mix" TEXT,
    "step_count" INTEGER,
    "personalization_depth" TEXT,
    "parent_config_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outreach_configs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outreach_configs_organization_id_idx" ON "outreach_configs"("organization_id");
CREATE INDEX "outreach_configs_organization_id_feature_key_status_idx"
    ON "outreach_configs"("organization_id", "feature_key", "status");

CREATE TABLE "outreach_zone_pointers" (
    "organization_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    CONSTRAINT "outreach_zone_pointers_pkey" PRIMARY KEY ("organization_id", "feature_key", "zone")
);
CREATE INDEX "outreach_zone_pointers_organization_id_idx" ON "outreach_zone_pointers"("organization_id");

CREATE TABLE "ai_generations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "lead_id" TEXT,
    "user_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "system_prompt_hash" TEXT NOT NULL,
    "user_prompt" TEXT NOT NULL,
    "context_hash" TEXT NOT NULL,
    "output" JSONB NOT NULL DEFAULT '{}',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "accepted" BOOLEAN,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_generations_organization_id_idx" ON "ai_generations"("organization_id");
CREATE INDEX "ai_generations_organization_id_config_id_created_at_idx"
    ON "ai_generations"("organization_id", "config_id", "created_at");
CREATE INDEX "ai_generations_organization_id_lead_id_idx"
    ON "ai_generations"("organization_id", "lead_id");

CREATE TABLE "sequence_step_provenance" (
    "followup_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "lead_id" TEXT,
    "generation_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "experiment_id" TEXT,
    "variant_id" TEXT,
    "step_index" INTEGER NOT NULL,
    "channel" TEXT,
    "generated_subject" TEXT,
    "generated_body" TEXT,
    "sent_subject" TEXT,
    "sent_body" TEXT,
    "edit_distance" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sequence_step_provenance_pkey" PRIMARY KEY ("followup_id")
);
CREATE INDEX "sequence_step_provenance_organization_id_idx"
    ON "sequence_step_provenance"("organization_id");
CREATE INDEX "sequence_step_provenance_organization_id_config_id_idx"
    ON "sequence_step_provenance"("organization_id", "config_id");
CREATE INDEX "sequence_step_provenance_organization_id_generation_id_idx"
    ON "sequence_step_provenance"("organization_id", "generation_id");
CREATE INDEX "sequence_step_provenance_organization_id_plan_id_idx"
    ON "sequence_step_provenance"("organization_id", "plan_id");

CREATE TABLE "eval_dataset_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "lead_context" JSONB NOT NULL,
    "thread_context" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eval_dataset_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "eval_dataset_items_organization_id_dataset_key_active_idx"
    ON "eval_dataset_items"("organization_id", "dataset_key", "active");

CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "pass_count" INTEGER NOT NULL DEFAULT 0,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "hallucination_count" INTEGER NOT NULL DEFAULT 0,
    "mean_judge_score" DOUBLE PRECISION,
    "compared_to_config_id" TEXT,
    "pairwise_wins" INTEGER,
    "pairwise_losses" INTEGER,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "eval_runs_organization_id_config_id_idx"
    ON "eval_runs"("organization_id", "config_id");

CREATE TABLE "eval_results" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "eval_run_id" TEXT NOT NULL,
    "dataset_item_id" TEXT NOT NULL,
    "generation_id" TEXT,
    "rule_failures" JSONB NOT NULL DEFAULT '[]',
    "judge_scores" JSONB NOT NULL DEFAULT '{}',
    "judge_notes" TEXT,
    "passed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eval_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "eval_results_organization_id_eval_run_id_idx"
    ON "eval_results"("organization_id", "eval_run_id");

CREATE TABLE "experiments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "primary_metric" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 1,
    "min_per_arm" INTEGER NOT NULL DEFAULT 600,
    "started_at" TIMESTAMPTZ(3),
    "stopped_at" TIMESTAMPTZ(3),
    "stop_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "experiments_organization_id_status_idx"
    ON "experiments"("organization_id", "status");

CREATE TABLE "experiment_arms" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "allocation" INTEGER NOT NULL DEFAULT 50,
    "is_control" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "experiment_arms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "experiment_arms_organization_id_experiment_id_idx"
    ON "experiment_arms"("organization_id", "experiment_id");

CREATE TABLE "experiment_assignments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "arm_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "experiment_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "experiment_assignments_experiment_id_lead_id_key"
    ON "experiment_assignments"("experiment_id", "lead_id");
CREATE INDEX "experiment_assignments_organization_id_experiment_id_idx"
    ON "experiment_assignments"("organization_id", "experiment_id");

CREATE TABLE "outreach_config_scorecards" (
    "config_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "bounced" INTEGER NOT NULL DEFAULT 0,
    "positive_replies" INTEGER NOT NULL DEFAULT 0,
    "engaged_replies" INTEGER NOT NULL DEFAULT 0,
    "hard_no_count" INTEGER NOT NULL DEFAULT 0,
    "unsubscribe_count" INTEGER NOT NULL DEFAULT 0,
    "spam_complaint_count" INTEGER NOT NULL DEFAULT 0,
    "potential_score_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generation_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_count" INTEGER NOT NULL DEFAULT 0,
    "edit_distance_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "edit_distance_count" INTEGER NOT NULL DEFAULT 0,
    "maturity_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positive_reply_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engaged_reply_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mean_potential_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "acceptance_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mean_edit_distance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bounce_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unsubscribe_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hard_no_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spam_complaint_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "offline_pass_rate" DOUBLE PRECISION,
    "offline_hallucination" DOUBLE PRECISION,
    "judge_win_rate" DOUBLE PRECISION,
    "segments" JSONB NOT NULL DEFAULT '{}',
    "posterior_alpha" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "posterior_beta" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "confound_warnings" JSONB NOT NULL DEFAULT '[]',
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outreach_config_scorecards_pkey" PRIMARY KEY ("config_id")
);
CREATE INDEX "outreach_config_scorecards_organization_id_idx"
    ON "outreach_config_scorecards"("organization_id");

-- RLS
ALTER TABLE "outreach_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_configs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outreach_zone_pointers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_zone_pointers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_generations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_generations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sequence_step_provenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequence_step_provenance" FORCE ROW LEVEL SECURITY;
ALTER TABLE "eval_dataset_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eval_dataset_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "eval_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eval_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "eval_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eval_results" FORCE ROW LEVEL SECURITY;
ALTER TABLE "experiments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "experiments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "experiment_arms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "experiment_arms" FORCE ROW LEVEL SECURITY;
ALTER TABLE "experiment_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "experiment_assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outreach_config_scorecards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_config_scorecards" FORCE ROW LEVEL SECURITY;

CREATE POLICY outreach_configs_tenant_isolation ON "outreach_configs"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY outreach_configs_bypass_rls ON "outreach_configs"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY outreach_zone_pointers_tenant_isolation ON "outreach_zone_pointers"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY outreach_zone_pointers_bypass_rls ON "outreach_zone_pointers"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY ai_generations_tenant_isolation ON "ai_generations"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY ai_generations_bypass_rls ON "ai_generations"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY sequence_step_provenance_tenant_isolation ON "sequence_step_provenance"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY sequence_step_provenance_bypass_rls ON "sequence_step_provenance"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY eval_dataset_items_tenant_isolation ON "eval_dataset_items"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY eval_dataset_items_bypass_rls ON "eval_dataset_items"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY eval_runs_tenant_isolation ON "eval_runs"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY eval_runs_bypass_rls ON "eval_runs"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY eval_results_tenant_isolation ON "eval_results"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY eval_results_bypass_rls ON "eval_results"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY experiments_tenant_isolation ON "experiments"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY experiments_bypass_rls ON "experiments"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY experiment_arms_tenant_isolation ON "experiment_arms"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY experiment_arms_bypass_rls ON "experiment_arms"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY experiment_assignments_tenant_isolation ON "experiment_assignments"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY experiment_assignments_bypass_rls ON "experiment_assignments"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

CREATE POLICY outreach_config_scorecards_tenant_isolation ON "outreach_config_scorecards"
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
CREATE POLICY outreach_config_scorecards_bypass_rls ON "outreach_config_scorecards"
  AS PERMISSIVE FOR ALL
  USING (NULLIF(current_setting('app.bypass_rls', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('app.bypass_rls', true), '') = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  outreach_configs,
  outreach_zone_pointers,
  ai_generations,
  sequence_step_provenance,
  eval_dataset_items,
  eval_runs,
  eval_results,
  experiments,
  experiment_arms,
  experiment_assignments,
  outreach_config_scorecards
  TO nova_app;
