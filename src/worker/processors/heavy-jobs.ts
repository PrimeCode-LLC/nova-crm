/**
 * Heavy background job processors (P4.4).
 * Prefer `src/lib/*` cron entrypoints over Cloud Functions forks.
 */

import { DelayedError, type Job } from "bullmq";
import {
  QUEUE_DASHBOARD_SUMMARY,
  QUEUE_SCRAPERS,
} from "../../lib/queue/queues";
import {
  assertTenantFairness,
  TENANT_RATE_WINDOW_SECONDS,
} from "../../lib/queue/fairness";
import { isScheduledEmailPgV1Enabled } from "../../lib/queue/flags";

export type OrgScopedJobData = {
  organizationId?: string;
};

async function delayIfUnfair(
  job: Job,
  queueName: string,
  organizationId: string | undefined,
  token?: string,
): Promise<void> {
  const fairness = await assertTenantFairness(queueName, organizationId);
  if (!fairness.allowed) {
    await job.moveToDelayed(Date.now() + TENANT_RATE_WINDOW_SECONDS * 1000, token);
    throw new DelayedError();
  }
}

export async function processImapSyncJob(
  _job: Job<OrgScopedJobData>,
): Promise<{ ok: true }> {
  const { runInboxImapSyncCronServer } = await import(
    "../../lib/email/inbox-imap-sync-cron-server"
  );
  await runInboxImapSyncCronServer();
  return { ok: true };
}

export async function processScheduledEmailJob(
  job: Job<OrgScopedJobData & { id?: string; leaseId?: string }>,
  token?: string,
): Promise<{ ok: true }> {
  const name = job.name;

  if (name === "send-one" && isScheduledEmailPgV1Enabled()) {
    const organizationId = job.data.organizationId?.trim();
    const id = job.data.id?.trim();
    const leaseId = job.data.leaseId?.trim();
    if (!organizationId || !id || !leaseId) {
      console.warn("[scheduled-email] send-one missing fields", job.data);
      return { ok: true };
    }
    await delayIfUnfair(job, "nova-scheduled-email", organizationId, token);
    const { sendClaimedScheduledEmailPg } = await import(
      "../../lib/email/send-claimed-scheduled-email-pg"
    );
    await sendClaimedScheduledEmailPg({ organizationId, id, leaseId });
    return { ok: true };
  }

  // send-tick (default) — PG dispatcher or legacy due scan
  if (isScheduledEmailPgV1Enabled()) {
    const { runScheduledEmailTickServer } = await import(
      "../../lib/email/scheduled-email-tick-server"
    );
    await runScheduledEmailTickServer();
    return { ok: true };
  }

  const { processDueScheduledEmailsServer } = await import(
    "../../lib/email/scheduled-emails-server"
  );
  await processDueScheduledEmailsServer();
  return { ok: true };
}

export async function processScrapersJob(
  job: Job<OrgScopedJobData & { organizationId?: string; mode?: "due" | "org" }>,
  token?: string,
): Promise<{ ok: true }> {
  if (job.data.mode === "org" && job.data.organizationId) {
    await delayIfUnfair(job, QUEUE_SCRAPERS, job.data.organizationId, token);

    const { runScraperFeedsServer } = await import(
      "../../lib/scrapers/run-feeds-server"
    );
    await runScraperFeedsServer({ organizationId: job.data.organizationId });
    return { ok: true };
  }
  const { runAllOrganizationsScrapersDueServer } = await import(
    "../../lib/scrapers/run-feeds-server"
  );
  const { cleanupIntakePoolServer } = await import(
    "../../lib/scrapers/raw-items-server"
  );
  await runAllOrganizationsScrapersDueServer();
  await cleanupIntakePoolServer();
  return { ok: true };
}

export async function processContentRemindersJob(
  _job: Job<OrgScopedJobData>,
): Promise<{ ok: true }> {
  const { processContentCaptureRemindersServer } = await import(
    "../../lib/content-calendar/capture-reminders-server"
  );
  await processContentCaptureRemindersServer();
  return { ok: true };
}

export async function processDashboardSummaryJob(
  job: Job<{ organizationId?: string; mode?: "dirty" | "org" }>,
  token?: string,
): Promise<{ ok: true }> {
  if (job.data.mode === "org" && job.data.organizationId) {
    await delayIfUnfair(
      job,
      QUEUE_DASHBOARD_SUMMARY,
      job.data.organizationId,
      token,
    );

    const { recomputeOrgDashboardSummaryPostgres } = await import(
      "../../lib/db/org-dashboard-summary-refresh"
    );
    await recomputeOrgDashboardSummaryPostgres(job.data.organizationId);
    return { ok: true };
  }
  const { refreshDirtyOrgDashboardSummariesPostgres } = await import(
    "../../lib/db/org-dashboard-summary-refresh"
  );
  await refreshDirtyOrgDashboardSummariesPostgres();
  return { ok: true };
}
