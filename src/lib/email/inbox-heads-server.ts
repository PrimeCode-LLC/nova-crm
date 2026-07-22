import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import type { MailInbound } from "@/lib/email-account-types";

const INBOX_SYNC_COLLECTION = "inboxSync";
const INBOX_HEADS_DOC = "heads";

function mailboxRef(orgId: string, uid: string, mailboxId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid)
    .collection("emailMailboxes")
    .doc(mailboxId);
}

function headsRef(orgId: string, uid: string, mailboxId: string) {
  const mb = mailboxRef(orgId, uid, mailboxId);
  if (!mb) return null;
  return mb.collection(INBOX_SYNC_COLLECTION).doc(INBOX_HEADS_DOC);
}

/** Compact head row stored in Firestore (no full bodies). */
export type StoredInboxHead = {
  id: string;
  uid: number;
  subject: string;
  from: string;
  replyTo?: string;
  to: string;
  cc?: string;
  date: string;
  seen: boolean;
  preview: string;
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  bodySynced: false;
  bodyText: "";
};

export function toStoredInboxHead(m: MailInbound): StoredInboxHead {
  return {
    id: m.id,
    uid: m.uid,
    subject: m.subject,
    from: m.from,
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    to: m.to,
    ...(m.cc ? { cc: m.cc } : {}),
    date: m.date,
    seen: m.seen,
    preview: m.preview || m.subject,
    ...(m.messageId ? { messageId: m.messageId } : {}),
    ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
    ...(m.referenceIds?.length ? { referenceIds: m.referenceIds } : {}),
    bodySynced: false,
    bodyText: "",
  };
}

export function storedHeadToMailInbound(raw: Record<string, unknown>): MailInbound | null {
  const uid = Number(raw.uid);
  if (!Number.isFinite(uid)) return null;
  const id = String(raw.id ?? `uid-${uid}`);
  const referenceIds = Array.isArray(raw.referenceIds)
    ? raw.referenceIds.map((x) => String(x)).filter(Boolean)
    : undefined;
  return {
    id,
    uid,
    subject: String(raw.subject ?? ""),
    from: String(raw.from ?? ""),
    ...(raw.replyTo ? { replyTo: String(raw.replyTo) } : {}),
    to: String(raw.to ?? ""),
    ...(raw.cc ? { cc: String(raw.cc) } : {}),
    date: String(raw.date ?? new Date(0).toISOString()),
    seen: Boolean(raw.seen),
    preview: String(raw.preview ?? raw.subject ?? ""),
    bodyText: "",
    bodySynced: false,
    ...(raw.messageId ? { messageId: String(raw.messageId) } : {}),
    ...(raw.inReplyTo ? { inReplyTo: String(raw.inReplyTo) } : {}),
    ...(referenceIds?.length ? { referenceIds } : {}),
  };
}

export async function writeInboxHeadsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  messages: MailInbound[];
  mailboxTotal: number;
}): Promise<void> {
  const ref = headsRef(input.organizationId, input.uid, input.mailboxId);
  const mb = mailboxRef(input.organizationId, input.uid, input.mailboxId);
  if (!ref || !mb) return;

  const syncedAt = new Date().toISOString();
  const heads = input.messages.map(toStoredInboxHead);
  const unreadCount = heads.filter((h) => !h.seen).length;

  await ref.set({
    messages: heads,
    mailboxTotal: input.mailboxTotal,
    syncedAt,
    unreadCount,
    headCount: heads.length,
  });
  await mb.set(
    {
      inboxLastSyncedAt: syncedAt,
      inboxLastSyncError: null,
      inboxMailboxTotal: input.mailboxTotal,
      inboxUnreadHeadCount: unreadCount,
      updatedAt: syncedAt,
    },
    { merge: true },
  );
}

export async function markInboxSyncErrorServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  error: string;
}): Promise<void> {
  const mb = mailboxRef(input.organizationId, input.uid, input.mailboxId);
  if (!mb) return;
  const syncedAt = new Date().toISOString();
  await mb.set(
    {
      inboxLastSyncedAt: syncedAt,
      inboxLastSyncError: input.error.slice(0, 500),
      updatedAt: syncedAt,
    },
    { merge: true },
  );
}

export async function readInboxHeadsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<{ messages: MailInbound[]; syncedAt: string | null; mailboxTotal: number }> {
  const ref = headsRef(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return { messages: [], syncedAt: null, mailboxTotal: 0 };
  const snap = await ref.get();
  if (!snap.exists) return { messages: [], syncedAt: null, mailboxTotal: 0 };
  const data = snap.data() as Record<string, unknown>;
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  const messages: MailInbound[] = [];
  for (const row of rawMessages) {
    if (!row || typeof row !== "object") continue;
    const parsed = storedHeadToMailInbound(row as Record<string, unknown>);
    if (parsed) messages.push(parsed);
  }
  return {
    messages,
    syncedAt: data.syncedAt ? String(data.syncedAt) : null,
    mailboxTotal: Number(data.mailboxTotal ?? 0) || 0,
  };
}
