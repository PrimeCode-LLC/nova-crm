import type { EmailMailboxSettings, MailSent, ScheduledEmail } from "@/lib/email-account-types";
import { addUtcDayKey, scheduleDayKeyFromDate } from "@/lib/email/mailbox-schedule-capacity";
import { resolveOrgTimezone } from "@/lib/org-timezone";

export type MailboxUtilizationStatus =
  | "hot"
  | "healthy"
  | "underused"
  | "idle"
  | "unassigned"
  | "unlimited"
  | "disabled";

export type MailboxUtilizationRow = {
  mailboxId: string;
  /** Member who owns the mailbox profile (credentials / sendStats path). */
  ownerUid: string;
  label: string;
  emailAddress: string;
  enabled: boolean;
  dailySendLimit: number | null;
  assignedUserIds: string[];
  sentToday: number;
  /** Sum of sendStats over the last 7 UTC days (including today). */
  sentWeek: number;
  /** sentWeek / 7 */
  avgDailyWeek: number;
  pendingToday: number;
  /** Pending/processing scheduled across the next 7 UTC days. */
  pendingWeek: number;
  /** Today sent / limit · 0–100+, null when no limit. */
  utilizationToday: number | null;
  /** Week avg daily / limit · 0–100+, null when no limit. */
  utilizationWeek: number | null;
  status: MailboxUtilizationStatus;
};

export type MailboxUtilizationSummary = {
  mailboxCount: number;
  needsAttention: number;
  wellUtilized: number;
  unassigned: number;
  totalSentToday: number;
  totalCapacityToday: number | null;
};

export const MAILBOX_UTILIZATION_STATUS_LABEL: Record<MailboxUtilizationStatus, string> = {
  hot: "Near limit",
  healthy: "Healthy",
  underused: "Underused",
  idle: "Idle",
  unassigned: "Unassigned",
  unlimited: "No limit",
  disabled: "Disabled",
};

function pct(numer: number, denom: number | null): number | null {
  if (denom == null || denom <= 0) return null;
  return Math.round((numer / denom) * 1000) / 10;
}

export function classifyMailboxUtilization(input: {
  enabled: boolean;
  assignedUserIds: readonly string[];
  dailySendLimit: number | null;
  sentToday: number;
  sentWeek: number;
  avgDailyWeek: number;
  pendingToday: number;
}): MailboxUtilizationStatus {
  if (!input.enabled) return "disabled";
  if (input.assignedUserIds.length === 0) return "unassigned";
  if (input.dailySendLimit == null) {
    if (input.sentWeek === 0 && input.pendingToday === 0) return "idle";
    return "unlimited";
  }
  const util = (input.avgDailyWeek / input.dailySendLimit) * 100;
  const todayUtil = (input.sentToday / input.dailySendLimit) * 100;
  if (todayUtil >= 85 || util >= 85) return "hot";
  if (input.sentWeek === 0 && input.pendingToday === 0) return "idle";
  if (util >= 40) return "healthy";
  return "underused";
}

/** Higher = more urgent for an owner to act on wasted capacity. */
export function mailboxAttentionRank(status: MailboxUtilizationStatus): number {
  switch (status) {
    case "unassigned":
      return 100;
    case "idle":
      return 90;
    case "underused":
      return 70;
    case "unlimited":
      return 40;
    case "disabled":
      return 20;
    case "healthy":
      return 10;
    case "hot":
      return 5;
    default:
      return 0;
  }
}

export function buildMailboxUtilizationRow(input: {
  mailboxId: string;
  ownerUid: string;
  label: string;
  emailAddress: string;
  enabled: boolean;
  dailySendLimit: number | null;
  assignedUserIds: string[];
  sentToday: number;
  sentWeek: number;
  pendingToday: number;
  pendingWeek: number;
}): MailboxUtilizationRow {
  const avgDailyWeek = Math.round((input.sentWeek / 7) * 10) / 10;
  const status = classifyMailboxUtilization({
    enabled: input.enabled,
    assignedUserIds: input.assignedUserIds,
    dailySendLimit: input.dailySendLimit,
    sentToday: input.sentToday,
    sentWeek: input.sentWeek,
    avgDailyWeek,
    pendingToday: input.pendingToday,
  });
  return {
    ...input,
    avgDailyWeek,
    utilizationToday: pct(input.sentToday, input.dailySendLimit),
    utilizationWeek: pct(avgDailyWeek, input.dailySendLimit),
    status,
  };
}

export function summarizeMailboxUtilization(
  rows: readonly MailboxUtilizationRow[],
): MailboxUtilizationSummary {
  const active = rows.filter((r) => r.status !== "disabled");
  let totalCapacityToday: number | null = 0;
  let hasAnyLimit = false;
  for (const r of active) {
    if (r.dailySendLimit != null) {
      hasAnyLimit = true;
      totalCapacityToday += r.dailySendLimit;
    }
  }
  return {
    mailboxCount: active.length,
    needsAttention: active.filter((r) => mailboxAttentionRank(r.status) >= 70).length,
    wellUtilized: active.filter((r) => r.status === "healthy" || r.status === "hot").length,
    unassigned: active.filter((r) => r.status === "unassigned").length,
    totalSentToday: active.reduce((sum, r) => sum + r.sentToday, 0),
    totalCapacityToday: hasAnyLimit ? totalCapacityToday : null,
  };
}

export function pickNeedsAttentionRows(
  rows: readonly MailboxUtilizationRow[],
  limit = 3,
): MailboxUtilizationRow[] {
  return [...rows]
    .filter((r) => r.status !== "disabled")
    .sort((a, b) => {
      const rank = mailboxAttentionRank(b.status) - mailboxAttentionRank(a.status);
      if (rank !== 0) return rank;
      const ua = a.utilizationWeek ?? -1;
      const ub = b.utilizationWeek ?? -1;
      if (ua !== ub) return ua - ub;
      return a.sentWeek - b.sentWeek;
    })
    .slice(0, limit);
}

export function pickWellUtilizedRows(
  rows: readonly MailboxUtilizationRow[],
  limit = 3,
): MailboxUtilizationRow[] {
  return [...rows]
    .filter((r) => r.status !== "disabled" && r.status !== "unassigned")
    .sort((a, b) => {
      const ua = a.utilizationWeek ?? a.avgDailyWeek;
      const ub = b.utilizationWeek ?? b.avgDailyWeek;
      if (ub !== ua) return ub - ua;
      return b.sentWeek - a.sentWeek;
    })
    .slice(0, limit);
}

/** True when the viewer owns the mailbox credentials or is assigned to send from it. */
export function isMailboxAssignedToViewer(
  row: Pick<MailboxUtilizationRow, "ownerUid" | "assignedUserIds">,
  viewerUid: string,
): boolean {
  if (!viewerUid) return false;
  if (row.ownerUid === viewerUid) return true;
  return row.assignedUserIds.includes(viewerUid);
}

/** Salespeople see only inboxes they own or are assigned to; managers keep the full list. */
export function filterMailboxUtilizationForViewer(
  rows: readonly MailboxUtilizationRow[],
  viewerUid: string,
): MailboxUtilizationRow[] {
  return rows.filter((row) => isMailboxAssignedToViewer(row, viewerUid));
}

/** Demo / offline builder from the local email account store. */
export function buildDemoMailboxUtilization(input: {
  mailboxes: readonly EmailMailboxSettings[];
  sent: readonly MailSent[];
  scheduled: readonly ScheduledEmail[];
  /** Fallback owner when mailbox has no dataOwnerUid. */
  currentUserId: string;
  timeZone?: string;
}): MailboxUtilizationRow[] {
  const zone = resolveOrgTimezone(input.timeZone);
  const todayKey = scheduleDayKeyFromDate(new Date(), zone);
  const weekStart = addUtcDayKey(todayKey, -6);
  const weekEnd = addUtcDayKey(todayKey, 6);

  return input.mailboxes.map((mb) => {
    const ownerUid = mb.dataOwnerUid?.trim() || input.currentUserId;
    let sentToday = 0;
    let sentWeek = 0;
    for (const m of input.sent) {
      if (m.mailboxId !== mb.id) continue;
      const day = scheduleDayKeyFromDate(m.sentAt, zone);
      if (!day) continue;
      if (day === todayKey) sentToday += 1;
      if (day >= weekStart && day <= todayKey) sentWeek += 1;
    }

    let pendingToday = 0;
    let pendingWeek = 0;
    for (const row of input.scheduled) {
      if (row.mailboxId !== mb.id) continue;
      if (row.status !== "pending" && row.status !== "processing") continue;
      const day = scheduleDayKeyFromDate(row.scheduledAt, zone);
      if (!day) continue;
      if (day === todayKey) pendingToday += 1;
      if (day >= todayKey && day <= weekEnd) pendingWeek += 1;
    }

    return buildMailboxUtilizationRow({
      mailboxId: mb.id,
      ownerUid,
      label: mb.label || mb.displayName || mb.emailAddress || "Mailbox",
      emailAddress: mb.emailAddress,
      enabled: mb.enabled,
      dailySendLimit: mb.dailySendLimit,
      assignedUserIds: [...(mb.assignedUserIds ?? [])],
      sentToday,
      sentWeek,
      pendingToday,
      pendingWeek,
    });
  });
}
