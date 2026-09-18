-- Production companion for 20260918180000_pg_documents_payload_expr_indexes_v2.
-- Run outside a transaction against a large live DB (psql), then:
--   npx prisma migrate resolve --applied 20260918180000_pg_documents_payload_expr_indexes_v2
--
-- Additive: CREATE INDEX CONCURRENTLY IF NOT EXISTS only.
-- These match Prisma's (payload->'field') jsonb path filters (non-partial).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_lead_id_jsonb_idx"
  ON "pg_documents" ((payload->'leadId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_plan_id_jsonb_idx"
  ON "pg_documents" ((payload->'planId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_actor_id_jsonb_idx"
  ON "pg_documents" ((payload->'actorId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_author_id_jsonb_idx"
  ON "pg_documents" ((payload->'authorId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_lead_owner_id_jsonb_idx"
  ON "pg_documents" ((payload->'leadOwnerId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_user_id_jsonb_idx"
  ON "pg_documents" ((payload->'userId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_owner_id_jsonb_idx"
  ON "pg_documents" ((payload->'ownerId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_assignee_id_jsonb_idx"
  ON "pg_documents" ((payload->'assigneeId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_delivery_status_jsonb_idx"
  ON "pg_documents" ((payload->'deliveryStatus'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_due_at_jsonb_idx"
  ON "pg_documents" ((payload->'dueAt'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_sent_at_jsonb_idx"
  ON "pg_documents" ((payload->'sentAt'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_completed_at_jsonb_idx"
  ON "pg_documents" ((payload->'completedAt'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_paused_at_jsonb_idx"
  ON "pg_documents" ((payload->'pausedAt'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_payload_occurred_at_jsonb_idx"
  ON "pg_documents" ((payload->'occurredAt'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_org_root_lead_id_jsonb_idx"
  ON "pg_documents" ("organization_id", "collection_root", (payload->'leadId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "pg_documents_org_root_actor_id_jsonb_idx"
  ON "pg_documents" ("organization_id", "collection_root", (payload->'actorId'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_payload_last_activity_at_jsonb_idx"
  ON "leads" ((payload->'lastActivityAt'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_payload_last_reply_at_jsonb_idx"
  ON "leads" ((payload->'lastReplyAt'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_payload_last_email_opened_at_jsonb_idx"
  ON "leads" ((payload->'lastEmailOpenedAt'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_payload_linked_sales_lead_id_jsonb_idx"
  ON "leads" ((payload->'linkedSalesLeadId'));
