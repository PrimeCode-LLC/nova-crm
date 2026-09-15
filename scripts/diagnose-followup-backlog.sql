-- Diagnose "overdue followup + Try now" rows.
--
-- Run on the VPS:
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U nova -d nova_crm -f - < scripts/diagnose-followup-backlog.sql
--
-- Distinguishes the two states that look identical in the Followups UI:
--   A. reminder with no queued email  -> nothing will ever send on its own
--   B. queued email waiting behind per-mailbox pacing / quota / retry backoff

\echo '== 1. Is the send pipeline draining at all? =='
SELECT
  max(sent_at)                       AS last_send,
  now() - max(sent_at)               AS since_last_send,
  count(*) FILTER (WHERE sent_at > now() - interval '1 hour')  AS sent_last_hour,
  count(*) FILTER (WHERE sent_at > now() - interval '24 hours') AS sent_last_24h
FROM scheduled_emails
WHERE status = 'sent';

\echo '== 2. Queue state by status (last 48h of scheduled_at) =='
SELECT
  status,
  count(*)                AS rows,
  min(scheduled_at)       AS earliest,
  max(scheduled_at)       AS latest,
  count(*) FILTER (WHERE coalesce(not_before_at, scheduled_at) <= now()) AS already_due
FROM scheduled_emails
WHERE scheduled_at > now() - interval '48 hours'
GROUP BY status
ORDER BY rows DESC;

\echo '== 3. Overdue backlog per mailbox + pacing gate (why the tail is stuck) =='
SELECT
  se.organization_id,
  se.mailbox_id,
  count(*)                                                AS pending_due,
  min(coalesce(se.not_before_at, se.scheduled_at))         AS oldest_due,
  now() - min(coalesce(se.not_before_at, se.scheduled_at)) AS oldest_age,
  max(mss.next_available_at)                              AS mailbox_next_available,
  max(mss.last_sent_at)                                   AS mailbox_last_sent
FROM scheduled_emails se
LEFT JOIN mailbox_send_state mss
  ON  mss.organization_id  = se.organization_id
  AND mss.mailbox_owner_uid = se.mailbox_owner_uid
  AND mss.mailbox_id        = se.mailbox_id
WHERE se.status = 'pending'
  AND coalesce(se.not_before_at, se.scheduled_at) <= now()
GROUP BY se.organization_id, se.mailbox_id
ORDER BY pending_due DESC;

\echo '== 4. Same-instant clusters (spread collapse fingerprint) =='
SELECT
  scheduled_at,
  count(*) AS rows_at_same_instant,
  count(DISTINCT mailbox_id) AS mailboxes
FROM scheduled_emails
WHERE scheduled_at > now() - interval '24 hours'
GROUP BY scheduled_at
HAVING count(*) > 1
ORDER BY rows_at_same_instant DESC
LIMIT 20;

\echo '== 5. Skip / failure reasons on the backlog =='
SELECT
  status,
  failure_kind,
  last_skip_reason,
  attempts,
  count(*) AS rows,
  min(left(coalesce(error, ''), 120)) AS sample_error
FROM scheduled_emails
WHERE scheduled_at > now() - interval '48 hours'
  AND status IN ('pending', 'processing', 'failed')
GROUP BY status, failure_kind, last_skip_reason, attempts
ORDER BY rows DESC
LIMIT 30;

\echo '== 6. Leases stuck in processing (crashed worker leaves these behind) =='
SELECT id, mailbox_id, attempts, lease_until, now() - lease_until AS lease_expired_for
FROM scheduled_emails
WHERE status = 'processing'
ORDER BY lease_until
LIMIT 20;

\echo '== 7. Open followups past due: queued vs never-queued (the key question) =='
SELECT
  CASE
    WHEN coalesce(payload->>'scheduledEmailId', '') <> '' THEN 'has queued email'
    ELSE 'no queued email (manual reminder only)'
  END                                              AS kind,
  coalesce(payload->>'deliveryStatus', '(none)')   AS delivery_status,
  count(*)                                         AS rows,
  min(payload->>'dueAt')                           AS oldest_due_at,
  max(payload->>'dueAt')                           AS newest_due_at
FROM pg_documents
WHERE collection_root = 'followups'
  AND coalesce(payload->>'completedAt', '') = ''
  AND coalesce(payload->>'pausedAt', '') = ''
  AND (payload->>'dueAt') < to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
GROUP BY 1, 2
ORDER BY rows DESC;

\echo '== 8. Followups whose scheduledEmailId no longer resolves (orphaned) =='
SELECT count(*) AS orphaned_followups
FROM pg_documents d
WHERE d.collection_root = 'followups'
  AND coalesce(d.payload->>'completedAt', '') = ''
  AND coalesce(d.payload->>'scheduledEmailId', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_emails se
    WHERE se.id = d.payload->>'scheduledEmailId'
  );
