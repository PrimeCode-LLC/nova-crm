/**
 * Escalation for a stalled outbound queue.
 *
 * A deep send backlog is normal - rows are paced by the per-mailbox send gap.
 * What is *not* normal is rows the dispatcher could claim right now sitting
 * unclaimed and aging, which means the tick is not draining. Without this the
 * only symptom is followups that look perpetually due, with no failure anywhere.
 */

import {
  getScheduledEmailStallStatsPg,
  type ScheduledEmailStallStat,
} from "@/lib/email/scheduled-emails-repo";
import { createUserNotificationServer } from "@/lib/notifications/create-user-notification-server";
import { listMembersServer } from "@/lib/platform/members-server";
import { recordErrorLog } from "@/lib/error-logging/record-error-server";

/** Claimable rows must be at least this stale before we call it a stall. */
export const SCHEDULED_EMAIL_STALL_MIN_AGE_SECONDS = 10 * 60;

/** Do not re-check on every 15s tick. */
export const SCHEDULED_EMAIL_STALL_CHECK_INTERVAL_MS = 5 * 60_000;

/** Notification dedupe bucket, so a persistent stall alerts at most hourly. */
const ALERT_BUCKET_MS = 60 * 60_000;

let lastCheckedAt = 0;

export function stallAlertMessage(stat: ScheduledEmailStallStat): string {
  const minutes = Math.round(stat.oldestClaimableAgeSeconds / 60);
  const age = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  return `Outbound email queue is not draining: ${stat.claimable} email${
    stat.claimable === 1 ? "" : "s"
  } ready to send have been waiting up to ${age} (${stat.pendingDue} past due across ${
    stat.mailboxes
  } mailbox${stat.mailboxes === 1 ? "" : "es"}).`;
}

async function escalateOrgStall(
  stat: ScheduledEmailStallStat,
  bucket: number,
): Promise<void> {
  const message = stallAlertMessage(stat);

  await recordErrorLog({
    organizationId: stat.organizationId,
    message,
    location: "src/lib/email/scheduled-email-tick-server.ts",
    functionName: "runScheduledEmailTickServer",
    source: "server",
  }).catch(() => null);

  let members: Awaited<ReturnType<typeof listMembersServer>> = [];
  try {
    members = await listMembersServer(stat.organizationId);
  } catch {
    return;
  }

  const recipients = members.filter(
    (m) => m.status === "active" && (m.role === "owner" || m.role === "admin"),
  );

  for (const recipient of recipients) {
    await createUserNotificationServer({
      organizationId: stat.organizationId,
      recipientId: recipient.uid,
      actorId: "system",
      kind: "followup",
      message,
      target: "Outbound email queue",
      targetHref: "/admin/logs",
      id: `un-email-queue-stalled-${stat.organizationId}-${bucket}`,
    }).catch(() => null);
  }
}

/**
 * Detect and escalate stalled outbound queues. Safe to call on every tick -
 * self-throttles and swallows its own failures so it can never break dispatch.
 */
export async function alertStalledScheduledEmailsServer(options?: {
  now?: number;
  force?: boolean;
}): Promise<{ checked: boolean; stalledOrgs: number }> {
  const now = options?.now ?? Date.now();
  if (!options?.force && now - lastCheckedAt < SCHEDULED_EMAIL_STALL_CHECK_INTERVAL_MS) {
    return { checked: false, stalledOrgs: 0 };
  }
  lastCheckedAt = now;

  try {
    const stats = await getScheduledEmailStallStatsPg({
      minAgeSeconds: SCHEDULED_EMAIL_STALL_MIN_AGE_SECONDS,
    });
    if (stats.length === 0) return { checked: true, stalledOrgs: 0 };

    const bucket = Math.floor(now / ALERT_BUCKET_MS);
    for (const stat of stats) {
      console.warn("[scheduled-email-tick] stalled queue", {
        organizationId: stat.organizationId,
        claimable: stat.claimable,
        oldestClaimableAgeSeconds: stat.oldestClaimableAgeSeconds,
        pendingDue: stat.pendingDue,
      });
      await escalateOrgStall(stat, bucket);
    }
    return { checked: true, stalledOrgs: stats.length };
  } catch (err) {
    console.warn(
      "[scheduled-email-tick] stall check failed",
      err instanceof Error ? err.message : err,
    );
    return { checked: true, stalledOrgs: 0 };
  }
}

/** Test seam. */
export function resetStallAlertThrottleForTests(): void {
  lastCheckedAt = 0;
}
