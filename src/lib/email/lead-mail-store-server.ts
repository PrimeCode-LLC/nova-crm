import { createHash } from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import {
  LEAD_MAIL_BODY_HTML_MAX,
  LEAD_MAIL_BODY_TEXT_MAX,
  LEAD_MAIL_LIST_LIMIT,
  LEAD_MAIL_PREVIEW_MAX,
  type LeadMailMessage,
  type LeadMailUpsertInput,
} from "@/lib/email/lead-mail-types";

export function leadMailDocId(leadId: string, providerKey: string): string {
  return createHash("sha1").update(`${leadId}\0${providerKey}`).digest("hex");
}

function clampText(value: string | undefined, max: number): string {
  if (!value) return "";
  return value.length <= max ? value : value.slice(0, max);
}

function parseStoredLeadMail(id: string, data: Record<string, unknown>): LeadMailMessage | null {
  const leadId = String(data.leadId ?? "").trim();
  const organizationId = String(data.organizationId ?? "").trim();
  const providerKey = String(data.providerKey ?? "").trim();
  const direction = data.direction === "outbound" ? "outbound" : data.direction === "inbound" ? "inbound" : null;
  if (!leadId || !organizationId || !providerKey || !direction) return null;

  const referenceIds = Array.isArray(data.referenceIds)
    ? data.referenceIds.map((x) => String(x)).filter(Boolean)
    : undefined;

  return {
    id,
    organizationId,
    leadId,
    mailboxId: String(data.mailboxId ?? ""),
    mailboxOwnerUid: String(data.mailboxOwnerUid ?? ""),
    direction,
    providerKey,
    ...(typeof data.uid === "number" && Number.isFinite(data.uid) ? { uid: data.uid } : {}),
    subject: String(data.subject ?? ""),
    from: String(data.from ?? ""),
    to: String(data.to ?? ""),
    ...(data.cc ? { cc: String(data.cc) } : {}),
    ...(data.replyTo ? { replyTo: String(data.replyTo) } : {}),
    date: String(data.date ?? new Date(0).toISOString()),
    ...(typeof data.seen === "boolean" ? { seen: data.seen } : {}),
    preview: String(data.preview ?? ""),
    bodyText: String(data.bodyText ?? ""),
    ...(data.bodyHtml ? { bodyHtml: String(data.bodyHtml) } : {}),
    bodySynced: data.bodySynced !== false,
    ...(data.messageId ? { messageId: String(data.messageId) } : {}),
    ...(data.inReplyTo ? { inReplyTo: String(data.inReplyTo) } : {}),
    ...(referenceIds?.length ? { referenceIds } : {}),
    source: (String(data.source ?? "imap") as LeadMailMessage["source"]),
    createdAt: String(data.createdAt ?? data.updatedAt ?? new Date(0).toISOString()),
    updatedAt: String(data.updatedAt ?? data.createdAt ?? new Date(0).toISOString()),
  };
}

async function refreshLeadMailSummaryServer(input: {
  organizationId: string;
  leadId: string;
}): Promise<void> {
  const db = getAdminDb();
  if (!db) return;

  const snap = await db
    .collection(COLLECTIONS.leadMailMessages)
    .where("leadId", "==", input.leadId)
    .limit(LEAD_MAIL_LIST_LIMIT)
    .get();

  let emailMailCount = 0;
  let lastEmailAt: string | undefined;
  let lastInboundEmailAt: string | undefined;

  for (const doc of snap.docs) {
    const row = parseStoredLeadMail(doc.id, doc.data() as Record<string, unknown>);
    if (!row || row.organizationId !== input.organizationId) continue;
    emailMailCount += 1;
    if (!lastEmailAt || row.date > lastEmailAt) lastEmailAt = row.date;
    if (row.direction === "inbound" && (!lastInboundEmailAt || row.date > lastInboundEmailAt)) {
      lastInboundEmailAt = row.date;
    }
  }

  const now = new Date().toISOString();
  await db
    .collection(COLLECTIONS.leads)
    .doc(input.leadId)
    .set(
      stripUndefined({
        emailMailCount,
        lastEmailAt,
        lastInboundEmailAt,
        updatedAt: now,
      }),
      { merge: true },
    );
}

export async function listLeadMailMessagesServer(input: {
  organizationId: string;
  leadId: string;
  limit?: number;
}): Promise<LeadMailMessage[]> {
  const db = getAdminDb();
  if (!db) return [];

  const limit = Math.max(1, Math.min(300, input.limit ?? LEAD_MAIL_LIST_LIMIT));
  const snap = await db
    .collection(COLLECTIONS.leadMailMessages)
    .where("leadId", "==", input.leadId)
    .limit(limit)
    .get();

  const rows: LeadMailMessage[] = [];
  for (const doc of snap.docs) {
    const row = parseStoredLeadMail(doc.id, doc.data() as Record<string, unknown>);
    if (!row || row.organizationId !== input.organizationId) continue;
    rows.push(row);
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

export async function getLeadMailMessageServer(input: {
  organizationId: string;
  leadId: string;
  providerKey: string;
}): Promise<LeadMailMessage | null> {
  const db = getAdminDb();
  if (!db) return null;
  const id = leadMailDocId(input.leadId, input.providerKey);
  const snap = await db.collection(COLLECTIONS.leadMailMessages).doc(id).get();
  if (!snap.exists) return null;
  const row = parseStoredLeadMail(snap.id, snap.data() as Record<string, unknown>);
  if (!row || row.organizationId !== input.organizationId) return null;
  return row;
}

/**
 * Idempotent upsert of lead-scoped mail. Prefer filling bodies when a head already exists.
 * Returns count of written docs.
 */
export async function upsertLeadMailMessagesServer(input: {
  organizationId: string;
  leadId: string;
  mailboxOwnerUid?: string;
  messages: LeadMailUpsertInput[];
  /** Refresh denormalized counts on the lead (default true). */
  refreshSummary?: boolean;
}): Promise<{ written: number }> {
  const db = getAdminDb();
  if (!db || input.messages.length === 0) return { written: 0 };

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
  if (!leadSnap.exists) return { written: 0 };
  if (String(leadSnap.data()?.organizationId ?? "") !== input.organizationId) return { written: 0 };

  const now = new Date().toISOString();
  let written = 0;

  // Batches of 400 (Firestore limit 500).
  const chunks: LeadMailUpsertInput[][] = [];
  for (let i = 0; i < input.messages.length; i += 400) {
    chunks.push(input.messages.slice(i, i + 400));
  }

  for (const chunk of chunks) {
    const batch = db.batch();
    let chunkWritten = 0;
    const existingSnaps = await Promise.all(
      chunk.map((msg) =>
        db.collection(COLLECTIONS.leadMailMessages).doc(leadMailDocId(input.leadId, msg.providerKey)).get(),
      ),
    );

    chunk.forEach((msg, index) => {
      const providerKey = msg.providerKey.trim();
      if (!providerKey || !msg.mailboxId.trim()) return;

      const id = leadMailDocId(input.leadId, providerKey);
      const ref = db.collection(COLLECTIONS.leadMailMessages).doc(id);
      const existing = existingSnaps[index];
      const prev = existing?.exists
        ? parseStoredLeadMail(existing.id, existing.data() as Record<string, unknown>)
        : null;

      const incomingBodySynced = msg.bodySynced !== false && Boolean(msg.bodyText?.trim() || msg.bodyHtml?.trim());
      const keepPrevBody =
        prev?.bodySynced &&
        !incomingBodySynced &&
        Boolean(prev.bodyText.trim() || prev.bodyHtml?.trim());

      const bodyText = clampText(
        keepPrevBody ? prev!.bodyText : (msg.bodyText ?? prev?.bodyText ?? ""),
        LEAD_MAIL_BODY_TEXT_MAX,
      );
      const bodyHtmlRaw = keepPrevBody ? prev!.bodyHtml : (msg.bodyHtml ?? prev?.bodyHtml);
      const bodyHtml = bodyHtmlRaw ? clampText(bodyHtmlRaw, LEAD_MAIL_BODY_HTML_MAX) : undefined;
      const bodySynced = keepPrevBody ? true : incomingBodySynced || Boolean(bodyText.trim() || bodyHtml?.trim());
      const preview =
        clampText(msg.preview || bodyText || msg.subject || prev?.preview || "", LEAD_MAIL_PREVIEW_MAX) ||
        msg.subject.slice(0, LEAD_MAIL_PREVIEW_MAX);

      const doc: LeadMailMessage = {
        id,
        organizationId: input.organizationId,
        leadId: input.leadId,
        mailboxId: msg.mailboxId.trim(),
        mailboxOwnerUid: (msg.mailboxOwnerUid || input.mailboxOwnerUid || prev?.mailboxOwnerUid || "").trim(),
        direction: msg.direction,
        providerKey,
        ...(typeof msg.uid === "number" && Number.isFinite(msg.uid)
          ? { uid: msg.uid }
          : prev?.uid != null
            ? { uid: prev.uid }
            : {}),
        subject: msg.subject || prev?.subject || "",
        from: msg.from || prev?.from || "",
        to: msg.to || prev?.to || "",
        ...(msg.cc || prev?.cc ? { cc: msg.cc || prev?.cc } : {}),
        ...(msg.replyTo || prev?.replyTo ? { replyTo: msg.replyTo || prev?.replyTo } : {}),
        date: msg.date || prev?.date || now,
        ...(typeof msg.seen === "boolean"
          ? { seen: msg.seen }
          : typeof prev?.seen === "boolean"
            ? { seen: prev.seen }
            : {}),
        preview,
        bodyText,
        ...(bodyHtml ? { bodyHtml } : {}),
        bodySynced,
        ...(msg.messageId || prev?.messageId ? { messageId: msg.messageId || prev?.messageId } : {}),
        ...(msg.inReplyTo || prev?.inReplyTo ? { inReplyTo: msg.inReplyTo || prev?.inReplyTo } : {}),
        ...((msg.referenceIds?.length ? msg.referenceIds : prev?.referenceIds)?.length
          ? { referenceIds: msg.referenceIds?.length ? msg.referenceIds : prev?.referenceIds }
          : {}),
        source: msg.source || prev?.source || "imap",
        createdAt: prev?.createdAt || now,
        updatedAt: now,
      };

      batch.set(ref, stripUndefined(doc as unknown as Record<string, unknown>), { merge: true });
      chunkWritten += 1;
    });

    if (chunkWritten > 0) {
      await batch.commit();
      written += chunkWritten;
    }
  }

  if (input.refreshSummary !== false && written > 0) {
    try {
      await refreshLeadMailSummaryServer({
        organizationId: input.organizationId,
        leadId: input.leadId,
      });
    } catch {
      /* summary is denormalized convenience */
    }
  }

  return { written };
}
