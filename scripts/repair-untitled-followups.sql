-- Repair open followups with blank titles (optional, run after diagnose §9–11).
--
-- Preview first:
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U nova -d nova_crm -c "
--       SELECT count(*) FROM pg_documents
--       WHERE collection_root = 'followups'
--         AND coalesce(payload->>'completedAt', '') = ''
--         AND coalesce(trim(payload->>'title'), '') = '';
--     "
--
-- Then apply (fills title from emailSubject, else a channel/step fallback):
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U nova -d nova_crm -f - < scripts/repair-untitled-followups.sql

BEGIN;

\echo '== Preview: untitled open followups before repair =='
SELECT count(*) AS untitled_open
FROM pg_documents
WHERE collection_root = 'followups'
  AND coalesce(payload->>'completedAt', '') = ''
  AND coalesce(trim(payload->>'title'), '') = '';

\echo '== Repair: set title from emailSubject / channel fallback =='
UPDATE pg_documents
SET
  payload = jsonb_set(
    payload,
    '{title}',
    to_jsonb(
      CASE
        WHEN coalesce(trim(payload->>'emailSubject'), '') <> '' THEN trim(payload->>'emailSubject')
        WHEN coalesce(payload->>'channel', '') LIKE 'linkedin%' THEN 'LinkedIn step'
        WHEN coalesce(payload->>'channel', '') IN ('cold_email', 'personalized_email', 'website_form') THEN 'Email step'
        ELSE 'Untitled followup'
      END
    ),
    true
  ),
  updated_at = now()
WHERE collection_root = 'followups'
  AND coalesce(payload->>'completedAt', '') = ''
  AND coalesce(trim(payload->>'title'), '') = '';

\echo '== Remaining untitled open followups (should be 0) =='
SELECT count(*) AS untitled_open_after
FROM pg_documents
WHERE collection_root = 'followups'
  AND coalesce(payload->>'completedAt', '') = ''
  AND coalesce(trim(payload->>'title'), '') = '';

COMMIT;
