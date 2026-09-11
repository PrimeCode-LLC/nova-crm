/**
 * Scheduled-email dispatcher tick: reclaim leases, claim due rows, enqueue send-one jobs.
 */

import { getQueue, QUEUE_SCHEDULED_EMAIL } from "@/lib/queue/queues";
import { JOB_PRIORITY, tenantJobOptions } from "@/lib/queue/fairness";
import {
  claimDueBatch,
  reclaimExpiredLeases,
  DEFAULT_CLAIM_BATCH,
} from "@/lib/email/scheduled-emails-repo";
import { isScheduledEmailPgV1Enabled } from "@/lib/queue/flags";

export type SendOneJobData = {
  organizationId: string;
  id: string;
  leaseId: string;
};

export async function runScheduledEmailTickServer(input?: {
  organizationId?: string;
  mailboxOwnerUid?: string;
  limit?: number;
}): Promise<{ reclaimed: number; claimed: number; enqueued: number }> {
  if (!isScheduledEmailPgV1Enabled()) {
    // Legacy path still uses processDueScheduledEmailsServer in the worker.
    return { reclaimed: 0, claimed: 0, enqueued: 0 };
  }

  const reclaimed = await reclaimExpiredLeases();
  const claimed = await claimDueBatch({
    limit: input?.limit ?? DEFAULT_CLAIM_BATCH,
    organizationId: input?.organizationId,
    mailboxOwnerUid: input?.mailboxOwnerUid,
  });

  const queue = getQueue(QUEUE_SCHEDULED_EMAIL);
  let enqueued = 0;
  if (queue) {
    for (const row of claimed) {
      const data: SendOneJobData = {
        organizationId: row.organizationId,
        id: row.id,
        leaseId: row.leaseId,
      };
      await queue.add("send-one", data, {
        jobId: `send-${row.id}-${row.leaseId}`,
        ...tenantJobOptions(row.organizationId, JOB_PRIORITY.cron),
      });
      enqueued += 1;
    }
  } else {
    // No Redis: send inline sequentially (local/dev).
    const { sendClaimedScheduledEmailPg } = await import(
      "@/lib/email/send-claimed-scheduled-email-pg"
    );
    for (const row of claimed) {
      await sendClaimedScheduledEmailPg({
        organizationId: row.organizationId,
        id: row.id,
        leaseId: row.leaseId,
      });
      enqueued += 1;
    }
  }

  console.info("[scheduled-email-tick]", { reclaimed, claimed: claimed.length, enqueued });
  return { reclaimed, claimed: claimed.length, enqueued };
}
