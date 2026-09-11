/**
 * Relational scheduled-email repository (P0).
 * Claim path uses FOR UPDATE SKIP LOCKED + per-mailbox gap reservation.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import {
  withOrganizationScope,
  withRlsBypass,
  type TenantTx,
} from "@/lib/db/tenant-scope";
import type {
  ScheduledEmail,
  ScheduledEmailAttachment,
  ScheduledEmailFailureKind,
  ScheduledEmailStatus,
} from "@/lib/email-account-types";
import { addUtcDayKey } from "@/lib/email/mailbox-schedule-capacity";
import { resolveOrgTimezone, zonedDayKey, zonedWallTimeToUtc } from "@/lib/org-timezone";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { normalizeSendGapSeconds } from "@/lib/email/scheduled-send-failure";

export const SCHEDULED_EMAIL_LEASE_MS = 5 * 60 * 1000;
export const DEFAULT_CLAIM_BATCH = 200;

export type ScheduledEmailPayload = {
  body?: string;
  text?: string;
  html?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  displayName?: string;
  attachments?: ScheduledEmailAttachment[];
  inReplyTo?: string;
  referenceIds?: string[];
  forceNewThread?: boolean;
  nextRetryAt?: string;
};

export type ScheduledEmailRowInput = {
  id?: string;
  organizationId: string;
  mailboxOwnerUid: string;
  mailboxId: string;
  scheduledByUserId?: string;
  followupId?: string;
  leadId?: string;
  status?: ScheduledEmailStatus;
  scheduledAt: Date;
  notBeforeAt?: Date | null;
  attempts?: number;
  idempotencyKey?: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  payload: ScheduledEmailPayload;
};

type RowShape = {
  id: string;
  organizationId: string;
  mailboxOwnerUid: string;
  mailboxId: string;
  scheduledByUserId: string | null;
  followupId: string | null;
  leadId: string | null;
  status: string;
  scheduledAt: Date;
  notBeforeAt: Date | null;
  attempts: number;
  failureKind: string | null;
  leaseUntil: Date | null;
  leaseId: string | null;
  idempotencyKey: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  messageId: string | null;
  sentAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  error: string | null;
  lastSkipReason: string | null;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function asPayload(raw: unknown): ScheduledEmailPayload {
  if (!raw || typeof raw !== "object") return {};
  return raw as ScheduledEmailPayload;
}

export function rowToScheduledEmail(row: RowShape): ScheduledEmail {
  const payload = asPayload(row.payload);
  return {
    id: row.id,
    uid: row.mailboxOwnerUid,
    mailboxId: row.mailboxId,
    from: row.fromEmail,
    displayName: payload.displayName || undefined,
    replyTo: payload.replyTo || undefined,
    to: row.toEmail,
    cc: payload.cc || undefined,
    bcc: payload.bcc || undefined,
    subject: row.subject,
    body: payload.body ?? payload.text ?? "",
    text: payload.text ?? payload.body,
    html: payload.html,
    attachments: payload.attachments,
    scheduledAt: row.scheduledAt.toISOString(),
    status: row.status as ScheduledEmailStatus,
    createdAt: row.createdAt.toISOString(),
    scheduledByUserId: row.scheduledByUserId ?? undefined,
    sentAt: row.sentAt?.toISOString(),
    messageId: row.messageId ?? undefined,
    error: row.error ?? undefined,
    cancelledAt: row.cancelledAt?.toISOString(),
    cancelReason: row.cancelReason ?? undefined,
    followupId: row.followupId ?? undefined,
    leadId: row.leadId ?? undefined,
    inReplyTo: payload.inReplyTo,
    referenceIds: payload.referenceIds,
    forceNewThread: payload.forceNewThread,
    attempts: row.attempts,
    nextRetryAt: payload.nextRetryAt ?? row.notBeforeAt?.toISOString(),
    failureKind: (row.failureKind as ScheduledEmailFailureKind | null) ?? undefined,
  };
}

export type ClaimedScheduledEmail = ScheduledEmail & {
  leaseId: string;
  organizationId: string;
  mailboxOwnerUid: string;
};

function claimedFromRow(row: RowShape & { leaseId: string }): ClaimedScheduledEmail {
  const base = rowToScheduledEmail(row);
  return {
    ...base,
    leaseId: row.leaseId,
    organizationId: row.organizationId,
    mailboxOwnerUid: row.mailboxOwnerUid,
  };
}

export function resolveIdempotencyKey(input: {
  id: string;
  followupId?: string | null;
}): string {
  const followupId = input.followupId?.trim();
  return followupId || input.id;
}

export async function insertScheduledEmail(
  input: ScheduledEmailRowInput,
): Promise<{ ok: true; id: string } | { error: string }> {
  const id = input.id?.trim() || randomUUID();
  const idempotencyKey = resolveIdempotencyKey({
    id,
    followupId: input.idempotencyKey ?? input.followupId,
  });
  const now = new Date();
  try {
    await withOrganizationScope(input.organizationId, async (tx) => {
      await tx.scheduledEmailRow.create({
        data: {
          id,
          organizationId: input.organizationId,
          mailboxOwnerUid: input.mailboxOwnerUid,
          mailboxId: input.mailboxId,
          scheduledByUserId: input.scheduledByUserId ?? null,
          followupId: input.followupId ?? null,
          leadId: input.leadId ?? null,
          status: input.status ?? "pending",
          scheduledAt: input.scheduledAt,
          notBeforeAt: input.notBeforeAt ?? null,
          attempts: input.attempts ?? 0,
          idempotencyKey,
          toEmail: input.toEmail,
          fromEmail: input.fromEmail,
          subject: input.subject,
          payload: input.payload as Prisma.InputJsonValue,
          createdAt: now,
          updatedAt: now,
        },
      });
    });
    return { ok: true, id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("scheduled_emails_active_idem_idx") || message.includes("Unique constraint")) {
      return { error: "An active scheduled email already exists for this follow-up." };
    }
    return { error: message.slice(0, 500) };
  }
}

export async function getScheduledEmailById(input: {
  organizationId: string;
  id: string;
}): Promise<(ScheduledEmail & { organizationId: string; mailboxOwnerUid: string; leaseId?: string | null }) | null> {
  return withOrganizationScope(input.organizationId, async (tx) => {
    const row = await tx.scheduledEmailRow.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
    if (!row) return null;
    return {
      ...rowToScheduledEmail(row as RowShape),
      organizationId: row.organizationId,
      mailboxOwnerUid: row.mailboxOwnerUid,
      leaseId: row.leaseId,
    };
  });
}

export async function listScheduledEmailsForMemberPg(input: {
  organizationId: string;
  uid: string;
  status?: ScheduledEmailStatus | "pending" | "done";
  limit?: number;
}): Promise<ScheduledEmail[]> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 200));
  return withOrganizationScope(input.organizationId, async (tx) => {
    const where: Prisma.ScheduledEmailRowWhereInput = {
      organizationId: input.organizationId,
      mailboxOwnerUid: input.uid,
    };
    if (input.status === "pending") {
      where.status = { in: ["pending", "processing"] };
    } else if (input.status === "done") {
      where.status = { in: ["sent", "failed", "cancelled"] };
    } else if (input.status) {
      where.status = input.status;
    }
    const rows = await tx.scheduledEmailRow.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      take: limit,
    });
    return rows.map((r) => rowToScheduledEmail(r as RowShape));
  });
}

export async function cancelScheduledEmailPg(input: {
  organizationId: string;
  uid: string;
  id: string;
  reason?: string;
}): Promise<{ ok: true; row: ScheduledEmail | null } | { error: string }> {
  return withOrganizationScope(input.organizationId, async (tx) => {
    const existing = await tx.scheduledEmailRow.findFirst({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        mailboxOwnerUid: input.uid,
      },
    });
    if (!existing) return { error: "Scheduled email not found." };
    if (existing.status === "sent") {
      return { error: "Cannot cancel an email that was already sent." };
    }
    if (existing.status === "cancelled") {
      return { ok: true, row: rowToScheduledEmail(existing as RowShape) };
    }
    const now = new Date();
    const updated = await tx.scheduledEmailRow.update({
      where: { id: input.id },
      data: {
        status: "cancelled",
        cancelledAt: now,
        cancelReason: input.reason?.slice(0, 500) ?? null,
        leaseId: null,
        leaseUntil: null,
        updatedAt: now,
      },
    });
    return { ok: true, row: rowToScheduledEmail(updated as RowShape) };
  });
}

export async function retryScheduledEmailPg(input: {
  organizationId: string;
  uid: string;
  id: string;
  scheduledAt: Date;
}): Promise<{ ok: true; row: ScheduledEmail } | { error: string }> {
  return withOrganizationScope(input.organizationId, async (tx) => {
    const existing = await tx.scheduledEmailRow.findFirst({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        mailboxOwnerUid: input.uid,
      },
    });
    if (!existing) return { error: "Scheduled email not found." };
    if (existing.status !== "failed" && existing.status !== "pending") {
      return { error: "Only failed or pending scheduled emails can be retried." };
    }
    const payload = asPayload(existing.payload);
    const now = new Date();
    const nextPayload: ScheduledEmailPayload = { ...payload };
    delete nextPayload.nextRetryAt;
    const updated = await tx.scheduledEmailRow.update({
      where: { id: input.id },
      data: {
        status: "pending",
        scheduledAt: input.scheduledAt,
        notBeforeAt: null,
        failureKind: null,
        error: null,
        leaseId: null,
        leaseUntil: null,
        lastSkipReason: null,
        payload: nextPayload as unknown as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });
    return { ok: true, row: rowToScheduledEmail(updated as RowShape) };
  });
}

export async function updateScheduledEmailPg(
  organizationId: string,
  id: string,
  patch: {
    status?: ScheduledEmailStatus;
    attempts?: number;
    failureKind?: ScheduledEmailFailureKind | null;
    error?: string | null;
    notBeforeAt?: Date | null;
    leaseId?: string | null;
    leaseUntil?: Date | null;
    messageId?: string | null;
    sentAt?: Date | null;
    lastSkipReason?: string | null;
    payload?: ScheduledEmailPayload;
  },
): Promise<void> {
  await withOrganizationScope(organizationId, async (tx) => {
    const data: Prisma.ScheduledEmailRowUpdateInput = {
      updatedAt: new Date(),
    };
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.attempts !== undefined) data.attempts = patch.attempts;
    if (patch.failureKind !== undefined) data.failureKind = patch.failureKind;
    if (patch.error !== undefined) data.error = patch.error;
    if (patch.notBeforeAt !== undefined) data.notBeforeAt = patch.notBeforeAt;
    if (patch.leaseId !== undefined) data.leaseId = patch.leaseId;
    if (patch.leaseUntil !== undefined) data.leaseUntil = patch.leaseUntil;
    if (patch.messageId !== undefined) data.messageId = patch.messageId;
    if (patch.sentAt !== undefined) data.sentAt = patch.sentAt;
    if (patch.lastSkipReason !== undefined) data.lastSkipReason = patch.lastSkipReason;
    if (patch.payload !== undefined) {
      data.payload = patch.payload as Prisma.InputJsonValue;
    }
    await tx.scheduledEmailRow.update({ where: { id }, data });
  });
}

export async function countPendingByMailboxDayPg(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  fromDayKey: string;
  toDayKey: string;
  timeZone?: string;
}): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!input.mailboxId.trim()) return out;

  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const fromStart = zonedWallTimeToUtc(input.fromDayKey, 0, 0, 0, 0, zone);
  const toExclusiveKey = addUtcDayKey(input.toDayKey, 1);
  const toExclusive = zonedWallTimeToUtc(toExclusiveKey, 0, 0, 0, 0, zone);
  if (Number.isNaN(fromStart.getTime()) || Number.isNaN(toExclusive.getTime())) {
    return out;
  }

  const rows = await withOrganizationScope(input.organizationId, async (tx) =>
    tx.scheduledEmailRow.findMany({
      where: {
        organizationId: input.organizationId,
        mailboxOwnerUid: input.uid,
        mailboxId: input.mailboxId,
        status: { in: ["pending", "processing"] },
        scheduledAt: { gte: fromStart, lt: toExclusive },
      },
      select: { scheduledAt: true },
      take: 5000,
    }),
  );

  for (const row of rows) {
    const dayKey = zonedDayKey(row.scheduledAt, resolveOrgTimezone(zone, { fallback: "UTC" }));
    if (!dayKey || dayKey < input.fromDayKey || dayKey > input.toDayKey) continue;
    out[dayKey] = (out[dayKey] ?? 0) + 1;
  }
  return out;
}

type ClaimRawRow = {
  id: string;
  organization_id: string;
  mailbox_owner_uid: string;
  mailbox_id: string;
  scheduled_by_user_id: string | null;
  followup_id: string | null;
  lead_id: string | null;
  status: string;
  scheduled_at: Date;
  not_before_at: Date | null;
  attempts: number;
  failure_kind: string | null;
  lease_until: Date | null;
  lease_id: string;
  idempotency_key: string;
  to_email: string;
  from_email: string;
  subject: string;
  message_id: string | null;
  sent_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  error: string | null;
  last_skip_reason: string | null;
  payload: unknown;
  created_at: Date;
  updated_at: Date;
};

function rawToRow(r: ClaimRawRow): RowShape & { leaseId: string } {
  return {
    id: r.id,
    organizationId: r.organization_id,
    mailboxOwnerUid: r.mailbox_owner_uid,
    mailboxId: r.mailbox_id,
    scheduledByUserId: r.scheduled_by_user_id,
    followupId: r.followup_id,
    leadId: r.lead_id,
    status: r.status,
    scheduledAt: r.scheduled_at,
    notBeforeAt: r.not_before_at,
    attempts: r.attempts,
    failureKind: r.failure_kind,
    leaseUntil: r.lease_until,
    leaseId: r.lease_id,
    idempotencyKey: r.idempotency_key,
    toEmail: r.to_email,
    fromEmail: r.from_email,
    subject: r.subject,
    messageId: r.message_id,
    sentAt: r.sent_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    error: r.error,
    lastSkipReason: r.last_skip_reason,
    payload: r.payload,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Atomically claim due pending emails (at most one per mailbox), reserve send gap,
 * and return claimed rows. Uses FOR UPDATE SKIP LOCKED under RLS bypass.
 */
export async function claimDueBatch(input?: {
  limit?: number;
  /** Override gap seconds when mailbox profile is unknown at claim time. */
  defaultGapSeconds?: number;
  organizationId?: string;
  mailboxOwnerUid?: string;
}): Promise<ClaimedScheduledEmail[]> {
  const limit = Math.min(500, Math.max(1, input?.limit ?? DEFAULT_CLAIM_BATCH));
  const gapSeconds = normalizeSendGapSeconds(input?.defaultGapSeconds ?? null);
  const leaseMs = SCHEDULED_EMAIL_LEASE_MS;
  const overFetch = Math.min(2000, limit * 10);

  return withRlsBypass(async (tx) => {
    // Lock a window of due rows, then pick at most one per mailbox via DISTINCT ON.
    const candidates = await tx.$queryRaw<
      Array<{
        id: string;
        organization_id: string;
        mailbox_owner_uid: string;
        mailbox_id: string;
      }>
    >`
      WITH locked AS (
        SELECT
          se.id,
          se.organization_id,
          se.mailbox_owner_uid,
          se.mailbox_id,
          COALESCE(se.not_before_at, se.scheduled_at) AS due_at
        FROM scheduled_emails se
        LEFT JOIN mailbox_send_state mss
          ON mss.organization_id = se.organization_id
         AND mss.mailbox_owner_uid = se.mailbox_owner_uid
         AND mss.mailbox_id = se.mailbox_id
        WHERE se.status = 'pending'
          AND COALESCE(se.not_before_at, se.scheduled_at) <= now()
          AND (mss.next_available_at IS NULL OR mss.next_available_at <= now())
          AND (${input?.organizationId ?? null}::text IS NULL
               OR se.organization_id = ${input?.organizationId ?? null})
          AND (${input?.mailboxOwnerUid ?? null}::text IS NULL
               OR se.mailbox_owner_uid = ${input?.mailboxOwnerUid ?? null})
        ORDER BY COALESCE(se.not_before_at, se.scheduled_at) ASC
        LIMIT ${overFetch}
        FOR UPDATE OF se SKIP LOCKED
      ),
      picked AS (
        SELECT DISTINCT ON (organization_id, mailbox_owner_uid, mailbox_id)
          id, organization_id, mailbox_owner_uid, mailbox_id
        FROM locked
        ORDER BY organization_id, mailbox_owner_uid, mailbox_id, due_at ASC
        LIMIT ${limit}
      )
      SELECT id, organization_id, mailbox_owner_uid, mailbox_id FROM picked
    `;

    if (candidates.length === 0) return [];

    const claimed: ClaimedScheduledEmail[] = [];
    for (const c of candidates) {
      const leaseId = randomUUID();
      const leaseUntil = new Date(Date.now() + leaseMs);
      const updated = await tx.$queryRaw<ClaimRawRow[]>`
        UPDATE scheduled_emails
           SET status = 'processing',
               lease_id = ${leaseId},
               lease_until = ${leaseUntil},
               updated_at = now()
         WHERE id = ${c.id}
           AND status = 'pending'
        RETURNING
          id, organization_id, mailbox_owner_uid, mailbox_id, scheduled_by_user_id,
          followup_id, lead_id, status, scheduled_at, not_before_at, attempts,
          failure_kind, lease_until, lease_id, idempotency_key, to_email, from_email,
          subject, message_id, sent_at, cancelled_at, cancel_reason, error,
          last_skip_reason, payload, created_at, updated_at
      `;
      if (!updated[0]) continue;

      const nextAvailable = new Date(Date.now() + gapSeconds * 1000);
      await tx.$executeRaw`
        INSERT INTO mailbox_send_state (
          organization_id, mailbox_owner_uid, mailbox_id,
          next_available_at, updated_at
        ) VALUES (
          ${c.organization_id}, ${c.mailbox_owner_uid}, ${c.mailbox_id},
          ${nextAvailable}, now()
        )
        ON CONFLICT (organization_id, mailbox_owner_uid, mailbox_id)
        DO UPDATE SET
          next_available_at = EXCLUDED.next_available_at,
          updated_at = now()
      `;

      claimed.push(claimedFromRow(rawToRow(updated[0])));
    }
    return claimed;
  });
}

export async function reclaimExpiredLeases(): Promise<number> {
  return withRlsBypass(async (tx) => {
    const result = await tx.$executeRaw`
      UPDATE scheduled_emails
         SET status = 'pending',
             attempts = attempts + 1,
             lease_id = NULL,
             lease_until = NULL,
             last_skip_reason = 'lease_expired',
             updated_at = now()
       WHERE status = 'processing'
         AND lease_until IS NOT NULL
         AND lease_until < now()
    `;
    return typeof result === "number" ? result : 0;
  });
}

export async function markMailboxSentPg(input: {
  organizationId: string;
  mailboxOwnerUid: string;
  mailboxId: string;
  gapSeconds?: number | null;
}): Promise<void> {
  const gap = normalizeSendGapSeconds(input.gapSeconds ?? null);
  const nextAvailable = new Date(Date.now() + gap * 1000);
  const now = new Date();
  await withOrganizationScope(input.organizationId, async (tx) => {
    await tx.mailboxSendState.upsert({
      where: {
        organizationId_mailboxOwnerUid_mailboxId: {
          organizationId: input.organizationId,
          mailboxOwnerUid: input.mailboxOwnerUid,
          mailboxId: input.mailboxId,
        },
      },
      create: {
        organizationId: input.organizationId,
        mailboxOwnerUid: input.mailboxOwnerUid,
        mailboxId: input.mailboxId,
        nextAvailableAt: nextAvailable,
        lastSentAt: now,
        updatedAt: now,
      },
      update: {
        nextAvailableAt: nextAvailable,
        lastSentAt: now,
        updatedAt: now,
      },
    });
  });
}

export async function releaseClaimToPendingPg(input: {
  organizationId: string;
  id: string;
  leaseId: string;
  notBeforeAt?: Date | null;
  attempts?: number;
  failureKind?: ScheduledEmailFailureKind | null;
  error?: string | null;
  lastSkipReason?: string | null;
  payload?: ScheduledEmailPayload;
}): Promise<boolean> {
  return withOrganizationScope(input.organizationId, async (tx) => {
    const existing = await tx.scheduledEmailRow.findFirst({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        leaseId: input.leaseId,
        status: "processing",
      },
    });
    if (!existing) return false;
    const data: Prisma.ScheduledEmailRowUpdateInput = {
      status: "pending",
      leaseId: null,
      leaseUntil: null,
      updatedAt: new Date(),
    };
    if (input.notBeforeAt !== undefined) data.notBeforeAt = input.notBeforeAt;
    if (input.attempts !== undefined) data.attempts = input.attempts;
    if (input.failureKind !== undefined) data.failureKind = input.failureKind;
    if (input.error !== undefined) data.error = input.error;
    if (input.lastSkipReason !== undefined) data.lastSkipReason = input.lastSkipReason;
    if (input.payload !== undefined) {
      data.payload = input.payload as Prisma.InputJsonValue;
    }
    await tx.scheduledEmailRow.update({ where: { id: input.id }, data });
    return true;
  });
}

/** Dev/test helper: run arbitrary work inside org scope. */
export async function withScheduledEmailOrgScope<T>(
  organizationId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withOrganizationScope(organizationId, fn);
}
