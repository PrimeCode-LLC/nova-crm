import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { FieldValue } from "firebase-admin/firestore";

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

/** UTC calendar day key `yyyy-mm-dd`. */
export function utcSendDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function getMailboxSendCountForDayServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  dayKey?: string;
}): Promise<number> {
  const dayKey = input.dayKey ?? utcSendDayKey();
  const ref = sendStatsRef(input.organizationId, input.uid, input.mailboxId, dayKey);
  if (!ref) return 0;
  const snap = await ref.get();
  if (!snap.exists) return 0;
  return Math.max(0, Number((snap.data() as Record<string, unknown>).count ?? 0));
}

export type MailboxQuotaCheck =
  | { ok: true; used: number; limit: number | null; remaining: number | null }
  | { ok: false; error: string; used: number; limit: number; status: 429 };

/** Rejects when `dailySendLimit` is set and today's count is already at/above the limit. */
export async function assertMailboxDailySendQuotaServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  dailySendLimit: number | null | undefined;
}): Promise<MailboxQuotaCheck> {
  const limit =
    input.dailySendLimit == null || !Number.isFinite(input.dailySendLimit) || input.dailySendLimit <= 0
      ? null
      : Math.floor(input.dailySendLimit);
  const used = input.mailboxId
    ? await getMailboxSendCountForDayServer({
        organizationId: input.organizationId,
        uid: input.uid,
        mailboxId: input.mailboxId,
      })
    : 0;

  if (limit == null) {
    return { ok: true, used, limit: null, remaining: null };
  }
  if (used >= limit) {
    return {
      ok: false,
      error: `Daily send limit reached (${used}/${limit}). Try again after midnight UTC.`,
      used,
      limit,
      status: 429,
    };
  }
  return { ok: true, used, limit, remaining: Math.max(0, limit - used) };
}

export async function incrementMailboxSendCountServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<void> {
  if (!input.mailboxId.trim()) return;
  const dayKey = utcSendDayKey();
  const ref = sendStatsRef(input.organizationId, input.uid, input.mailboxId, dayKey);
  if (!ref) return;
  await ref.set(
    {
      count: FieldValue.increment(1),
      dayKey,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
