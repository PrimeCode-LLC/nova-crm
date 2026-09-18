-- Phase 1: expression indexes for document-shim SQL pushdown on hot payload fields.
-- Additive only (CREATE INDEX IF NOT EXISTS). No DROP / TRUNCATE / data rewrites.
--
-- Prisma migrate wraps SQL in a transaction, so CONCURRENTLY cannot be used here.
-- For large production tables, prefer the companion script first:
--   scripts/create-pg-documents-payload-indexes-concurrently.sql
-- then `prisma migrate resolve` if needed. Local/staging can apply this migration as-is.

-- Equality / join keys (followups, tasks, plans, timeline)
CREATE INDEX IF NOT EXISTS "pg_documents_payload_lead_id_idx"
  ON "pg_documents" ((payload->>'leadId'))
  WHERE payload ? 'leadId';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_plan_id_idx"
  ON "pg_documents" ((payload->>'planId'))
  WHERE payload ? 'planId';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_actor_id_idx"
  ON "pg_documents" ((payload->>'actorId'))
  WHERE payload ? 'actorId';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_author_id_idx"
  ON "pg_documents" ((payload->>'authorId'))
  WHERE payload ? 'authorId';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_lead_owner_id_idx"
  ON "pg_documents" ((payload->>'leadOwnerId'))
  WHERE payload ? 'leadOwnerId';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_user_id_idx"
  ON "pg_documents" ((payload->>'userId'))
  WHERE payload ? 'userId';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_owner_id_idx"
  ON "pg_documents" ((payload->>'ownerId'))
  WHERE payload ? 'ownerId';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_assignee_id_idx"
  ON "pg_documents" ((payload->>'assigneeId'))
  WHERE payload ? 'assigneeId';

-- Instant fields used in range filters / sorts (ISO text)
CREATE INDEX IF NOT EXISTS "pg_documents_payload_due_at_idx"
  ON "pg_documents" ((payload->>'dueAt'))
  WHERE payload ? 'dueAt';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_sent_at_idx"
  ON "pg_documents" ((payload->>'sentAt'))
  WHERE payload ? 'sentAt';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_completed_at_idx"
  ON "pg_documents" ((payload->>'completedAt'))
  WHERE payload ? 'completedAt';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_paused_at_idx"
  ON "pg_documents" ((payload->>'pausedAt'))
  WHERE payload ? 'pausedAt';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_occurred_at_idx"
  ON "pg_documents" ((payload->>'occurredAt'))
  WHERE payload ? 'occurredAt';

CREATE INDEX IF NOT EXISTS "pg_documents_payload_delivery_status_idx"
  ON "pg_documents" ((payload->>'deliveryStatus'))
  WHERE payload ? 'deliveryStatus';

-- Composite helpers for the common (org, collection) + equality pattern
CREATE INDEX IF NOT EXISTS "pg_documents_org_root_lead_id_idx"
  ON "pg_documents" ("organization_id", "collection_root", (payload->>'leadId'))
  WHERE payload ? 'leadId';

CREATE INDEX IF NOT EXISTS "pg_documents_org_root_actor_id_idx"
  ON "pg_documents" ("organization_id", "collection_root", (payload->>'actorId'))
  WHERE payload ? 'actorId';

-- Lead payload instants (KPI / idle / replies) — dedicated table, additive
CREATE INDEX IF NOT EXISTS "leads_payload_last_activity_at_idx"
  ON "leads" ((payload->>'lastActivityAt'))
  WHERE payload ? 'lastActivityAt';

CREATE INDEX IF NOT EXISTS "leads_payload_last_reply_at_idx"
  ON "leads" ((payload->>'lastReplyAt'))
  WHERE payload ? 'lastReplyAt';

CREATE INDEX IF NOT EXISTS "leads_payload_last_email_opened_at_idx"
  ON "leads" ((payload->>'lastEmailOpenedAt'))
  WHERE payload ? 'lastEmailOpenedAt';

CREATE INDEX IF NOT EXISTS "leads_payload_linked_sales_lead_id_idx"
  ON "leads" ((payload->>'linkedSalesLeadId'))
  WHERE payload ? 'linkedSalesLeadId';
