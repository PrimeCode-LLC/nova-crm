-- Phase 1 fix: expression indexes that match Prisma JSON path filters.
-- Prior indexes used (payload->>'field') WITH partial WHERE payload ? 'field'.
-- Prisma emits (payload->'field') jsonb compares, which:
--   (a) do not imply `payload ? 'field'` to the planner, and
--   (b) do not match a text (->>) index expression.
-- Additive only: new index names. Old indexes left in place (unused but harmless).
-- For large prod tables prefer scripts/create-pg-documents-payload-indexes-concurrently.sql.

-- Equality / join keys — jsonb expression, non-partial
CREATE INDEX IF NOT EXISTS "pg_documents_payload_lead_id_jsonb_idx"
  ON "pg_documents" ((payload->'leadId'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_plan_id_jsonb_idx"
  ON "pg_documents" ((payload->'planId'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_actor_id_jsonb_idx"
  ON "pg_documents" ((payload->'actorId'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_author_id_jsonb_idx"
  ON "pg_documents" ((payload->'authorId'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_lead_owner_id_jsonb_idx"
  ON "pg_documents" ((payload->'leadOwnerId'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_user_id_jsonb_idx"
  ON "pg_documents" ((payload->'userId'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_owner_id_jsonb_idx"
  ON "pg_documents" ((payload->'ownerId'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_assignee_id_jsonb_idx"
  ON "pg_documents" ((payload->'assigneeId'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_delivery_status_jsonb_idx"
  ON "pg_documents" ((payload->'deliveryStatus'));

-- Instant fields (ISO strings stored as jsonb scalars)
CREATE INDEX IF NOT EXISTS "pg_documents_payload_due_at_jsonb_idx"
  ON "pg_documents" ((payload->'dueAt'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_sent_at_jsonb_idx"
  ON "pg_documents" ((payload->'sentAt'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_completed_at_jsonb_idx"
  ON "pg_documents" ((payload->'completedAt'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_paused_at_jsonb_idx"
  ON "pg_documents" ((payload->'pausedAt'));

CREATE INDEX IF NOT EXISTS "pg_documents_payload_occurred_at_jsonb_idx"
  ON "pg_documents" ((payload->'occurredAt'));

-- Composite helpers for (org, collection) + equality
CREATE INDEX IF NOT EXISTS "pg_documents_org_root_lead_id_jsonb_idx"
  ON "pg_documents" ("organization_id", "collection_root", (payload->'leadId'));

CREATE INDEX IF NOT EXISTS "pg_documents_org_root_actor_id_jsonb_idx"
  ON "pg_documents" ("organization_id", "collection_root", (payload->'actorId'));

-- Lead payload instants / links
CREATE INDEX IF NOT EXISTS "leads_payload_last_activity_at_jsonb_idx"
  ON "leads" ((payload->'lastActivityAt'));

CREATE INDEX IF NOT EXISTS "leads_payload_last_reply_at_jsonb_idx"
  ON "leads" ((payload->'lastReplyAt'));

CREATE INDEX IF NOT EXISTS "leads_payload_last_email_opened_at_jsonb_idx"
  ON "leads" ((payload->'lastEmailOpenedAt'));

CREATE INDEX IF NOT EXISTS "leads_payload_linked_sales_lead_id_jsonb_idx"
  ON "leads" ((payload->'linkedSalesLeadId'));
