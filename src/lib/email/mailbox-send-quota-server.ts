import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { FieldValue } from "firebase-admin/firestore";
import { addUtcDayKey } from "@/lib/email/mailbox-schedule-capacity";
import {
  resolveOrgTimezone,
  zonedDayKey,
  zonedWallTimeToUtc,
} from "@/lib/org-timezone";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import { assertOrgScheduleDayCeilingServer } from "@/lib/email/org-send-ledger-server";

const SCHEDULED_COLLECTION = "scheduledEmails";

function sendStatsRef(organizationId: string, uid: string, mailboxId: string, dayKey: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid)
    .collection("emailMailboxes")
    .doc(mailboxId)
    .collection("sendStats")
    .doc(dayKey);
}

function scheduledRoot(organizationId: string, uid: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid)
    .collection(SCHEDULED_COLLECTION);
}

/**
 * Calendar day key for send quotas in the given IANA zone (defaults to UTC).
 * Prefer passing the org workspace timezone.
 */
export function sendDayKey(date: Date = new Date(), timeZone?: string): string {
  const zone = resolveOrgTimezone(timeZone, { fallback: "UTC" });
  return zonedDayKey(date, zone);
}

/** @deprecated Prefer sendDayKey with org timezone. */
export function utcSendDayKey(date = new Date(), timeZone?: string): string {
  return sendDayKey(date, timeZone ?? "UTC");
}

export function addUtcDayKeys(dayKey: string, days: number): string {
  return addUtcDayKey(dayKey, days);
}

function normalizeDailyLimit(dailySendLimit: number | null | undefined): number | null {
  if (dailySendLimit == null || !Number.isFinite(dailySendLimit) || dailySendLimit <= 0) {
    return null;
  }
  return Math.floor(dailySendLimit);
}

export async function getMailboxSendCountForDayServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  dayKey?: string;
  timeZone?: string;
}): Promise<number> {
  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const dayKey = input.dayKey ?? sendDayKey(new Date(), zone);
  const ref = sendStatsRef(input.organizationId, input.uid, input.mailboxId, dayKey);
  if (!ref) return 0;
  const snap = await ref.get();
  if (!snap.exists) return 0;
  return Math.max(0, Number((snap.data() as Record<string, unknown>).count ?? 0));
}

/**
 * Counts pending/processing scheduled emails for a mailbox, bucketed by org calendar day.
 * Query range uses zoned day boundaries; buckets use the same timezone.
 */
export async function countPendingScheduledByUtcDayServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  fromDayKey: string;
  toDayKey: string;
  timeZone?: string;
}): Promise<Record<string, number>> {
  const root = scheduledRoot(input.organizationId, input.uid);
  const out: Record<string, number> = {};
  if (!root || !input.mailboxId.trim()) return out;

  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const fromStart = zonedWallTimeToUtc(input.fromDayKey, 0, 0, 0, 0, zone);
  const toExclusiveKey = addUtcDayKeys(input.toDayKey, 1);
  const toExclusive = zonedWallTimeToUtc(toExclusiveKey, 0, 0, 0, 0, zone);
  if (Number.isNaN(fromStart.getTime()) || Number.isNaN(toExclusive.getTime())) {
    return out;
  }
  const fromIso = fromStart.toISOString();
  const toIso = toExclusive.toISOString();

  const bump = (scheduledAt: string) => {
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime())) return;
    const dayKey = sendDayKey(d, zone);
    if (!dayKey || dayKey < input.fromDayKey || dayKey > input.toDayKey) return;
    out[dayKey] = (out[dayKey] ?? 0) + 1;
  };

  const countsForStatus = async (status: "pending" | "processing") => {
    try {
      const snap = await root
        .where("mailboxId", "==", input.mailboxId)
        .where("status", "==", status)
        .where("scheduledAt", ">=", fromIso)
        .where("scheduledAt", "<", toIso)
        .orderBy("scheduledAt", "asc")
        .limit(2000)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        bump(String(data.scheduledAt ?? ""));
      }
    } catch {
      // Index may still be building - fall back to broader query.
      const snap = await root
        .where("status", "==", status)
        .where("scheduledAt", ">=", fromIso)
        .where("scheduledAt", "<", toIso)
        .orderBy("scheduledAt", "asc")
        .limit(2000)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (String(data.mailboxId ?? "") !== input.mailboxId) continue;
        bump(String(data.scheduledAt ?? ""));
      }
    }
  };

  await Promise.all([countsForStatus("pending"), countsForStatus("processing")]);
  return out;
}

export type MailboxDayLoad = {
  dayKey: string;
  sent: number;
  pending: number;
  /** sent + pending already booked on this org calendar day */
  booked: number;
  limit: number | null;
  remaining: number | null;
};

export async function getMailboxDayLoadsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  dailySendLimit: number | null | undefined;
  /** Inclusive org day; defaults to today in org timezone. */
  fromDayKey?: string;
  /** Inclusive org day; defaults to today + 59. */
  toDayKey?: string;
  timeZone?: string;
}): Promise<{
  limit: number | null;
  fromDayKey: string;
  toDayKey: string;
  days: MailboxDayLoad[];
  byDay: Record<string, MailboxDayLoad>;
  timeZone: string;
}> {
  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const limit = normalizeDailyLimit(input.dailySendLimit);
  const fromDayKey = input.fromDayKey ?? sendDayKey(new Date(), zone);
  const toDayKey = input.toDayKey ?? addUtcDayKeys(fromDayKey, 59);
  const pendingByDay = await countPendingScheduledByUtcDayServer({
    organizationId: input.organizationId,
    uid: input.uid,
    mailboxId: input.mailboxId,
    fromDayKey,
    toDayKey,
    timeZone: zone,
  });

  const todayKey = sendDayKey(new Date(), zone);
  const sentToday =
    todayKey >= fromDayKey && todayKey <= toDayKey
      ? await getMailboxSendCountForDayServer({
          organizationId: input.organizationId,
          uid: input.uid,
          mailboxId: input.mailboxId,
          dayKey: todayKey,
          timeZone: zone,
        })
      : 0;

  const days: MailboxDayLoad[] = [];
  const byDay: Record<string, MailboxDayLoad> = {};
  for (let key = fromDayKey; key <= toDayKey; key = addUtcDayKeys(key, 1)) {
    const pending = pendingByDay[key] ?? 0;
    const sent = key === todayKey ? sentToday : 0;
    const booked = sent + pending;
    const remaining = limit == null ? null : Math.max(0, limit - booked);
    const row: MailboxDayLoad = { dayKey: key, sent, pending, booked, limit, remaining };
    days.push(row);
    byDay[key] = row;
  }

  return { limit, fromDayKey, toDayKey, days, byDay, timeZone: zone };
}

export type MailboxQuotaCheck =
  | { ok: true; used: number; limit: number | null; remaining: number | null }
  | { ok: false; error: string; used: number; limit: number; status: 429 };

/** Rejects when `dailySendLimit` is set and today's (org-local) count is already at/above the limit. */
export async function assertMailboxDailySendQuotaServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  dailySendLimit: number | null | undefined;
  timeZone?: string;
}): Promise<MailboxQuotaCheck> {
  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const limit = normalizeDailyLimit(input.dailySendLimit);
  const used = input.mailboxId
    ? await getMailboxSendCountForDayServer({
        organizationId: input.organizationId,
        uid: input.uid,
        mailboxId: input.mailboxId,
        timeZone: zone,
      })
    : 0;

  if (limit == null) {
    return { ok: true, used, limit: null, remaining: null };
  }
  if (used >= limit) {
    return {
      ok: false,
      error: `Daily send limit reached (${used}/${limit}). Try again after midnight (${zone}).`,
      used,
      limit,
      status: 429,
    };
  }
  return { ok: true, used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Soft schedule-time check: blocks when that org calendar day is already at/over capacity
 * (successful sends today + pending/processing scheduled for that day).
 */
export async function assertMailboxScheduleDayQuotaServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  dailySendLimit: number | null | undefined;
  scheduledAt: Date | string;
  timeZone?: string;
}): Promise<
  | { ok: true; dayKey: string; used: number; limit: number | null; remaining: number | null }
  | {
      ok: false;
      error: string;
      dayKey: string;
      used: number;
      limit: number;
      remaining: number;
      status: 429;
    }
> {
  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const limit = normalizeDailyLimit(input.dailySendLimit);
  const scheduledDate =
    input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt);
  const dayKey = sendDayKey(scheduledDate, zone);
  const todayKey = sendDayKey(new Date(), zone);

  if (limit == null || !input.mailboxId.trim()) {
    const orgOnly = await assertOrgScheduleDayCeilingServer({
      organizationId: input.organizationId,
      scheduledAt: scheduledDate,
      timeZone: zone,
    });
    if (!orgOnly.ok) {
      return {
        ok: false,
        error: orgOnly.error,
        dayKey: orgOnly.dayKey,
        used: orgOnly.used,
        limit: orgOnly.ceiling,
        remaining: 0,
        status: 429,
      };
    }
    return { ok: true, dayKey, used: 0, limit: null, remaining: null };
  }

  const [sent, pendingByDay] = await Promise.all([
    dayKey === todayKey
      ? getMailboxSendCountForDayServer({
          organizationId: input.organizationId,
          uid: input.uid,
          mailboxId: input.mailboxId,
          dayKey,
          timeZone: zone,
        })
      : Promise.resolve(0),
    countPendingScheduledByUtcDayServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: input.mailboxId,
      fromDayKey: dayKey,
      toDayKey: dayKey,
      timeZone: zone,
    }),
  ]);
  const pending = pendingByDay[dayKey] ?? 0;
  const used = sent + pending;
  if (used >= limit) {
    return {
      ok: false,
      error: `Daily send limit full for ${dayKey} (${used}/${limit} booked). Pick another day or mailbox.`,
      dayKey,
      used,
      limit,
      remaining: 0,
      status: 429,
    };
  }
  const orgCeiling = await assertOrgScheduleDayCeilingServer({
    organizationId: input.organizationId,
    scheduledAt: scheduledDate,
    timeZone: zone,
  });
  if (!orgCeiling.ok) {
    return {
      ok: false,
      error: orgCeiling.error,
      dayKey: orgCeiling.dayKey,
      used: orgCeiling.used,
      limit: orgCeiling.ceiling,
      remaining: 0,
      status: 429,
    };
  }
  return { ok: true, dayKey, used, limit, remaining: Math.max(0, limit - used) };
}

export async function getMailboxLastSentAtServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  timeZone?: string;
}): Promise<string | undefined> {
  if (!input.mailboxId.trim()) return undefined;
  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const dayKey = sendDayKey(new Date(), zone);
  const ref = sendStatsRef(input.organizationId, input.uid, input.mailboxId, dayKey);
  if (!ref) return undefined;
  const snap = await ref.get();
  if (!snap.exists) return undefined;
  const last = (snap.data() as Record<string, unknown>).lastSentAt;
  return typeof last === "string" && last.trim() ? last.trim() : undefined;
}

export async function incrementMailboxSendCountServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  timeZone?: string;
}): Promise<void> {
  if (!input.mailboxId.trim()) return;
  const zone =
    input.timeZone ?? (await getOrgTimezoneServer(input.organizationId));
  const dayKey = sendDayKey(new Date(), zone);
  const ref = sendStatsRef(input.organizationId, input.uid, input.mailboxId, dayKey);
  if (!ref) return;
  const now = new Date().toISOString();
  await ref.set(
    {
      count: FieldValue.increment(1),
      dayKey,
      timeZone: zone,
      lastSentAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
}
