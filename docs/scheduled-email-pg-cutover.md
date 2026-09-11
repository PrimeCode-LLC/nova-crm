# Scheduled email PG cutover

## Prerequisites

1. Deploy migration `20260911170000_scheduled_emails_relational` (`npm run db:migrate:deploy` / Compose migrate service).
2. Ensure web + worker can reach Redis (`REDIS_URL`) and Postgres.
3. Keep `SCHEDULED_EMAIL_PG_V1` unset/false until backfill completes.

## Steps

1. **Migrate**
   ```bash
   npm run db:migrate:deploy
   # or: docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
   ```

2. **Backfill** (idempotent)
   ```bash
   MIGRATE_DATABASE_URL=... npx tsx scripts/backfill-scheduled-emails.ts
   ```
   Confirm counts: `upserted` ≈ pending+history docs; `errors` = 0.

3. **Flip flag** on web and worker:
   ```
   SCHEDULED_EMAIL_PG_V1=true
   ```
   Redeploy/restart both services.

4. **Verify**
   - Schedule a test follow-up email ≥1 minute out.
   - Confirm a row in `scheduled_emails` with `status=pending`.
   - Wait for JobScheduler / cron tick; confirm `status=sent` and SMTP delivery.
   - Confirm browser open does **not** need to flush; worker handles send.
   - Spot-check `email_events` for `scheduled` / `sent`.

5. **Follow-up release** (after stable soak)
   - Remove legacy document-shim branches in `scheduled-emails-server.ts`.
   - Remove `collectionGroup("scheduledEmails")` due scans.
   - Optionally archive old nested docs.

## Rollback

Set `SCHEDULED_EMAIL_PG_V1=false` and restart. Legacy doc path resumes (new schedules after cutover may only exist in PG — re-schedule those if rolling back mid-flight).
