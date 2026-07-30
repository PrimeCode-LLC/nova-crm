import type { MailInbound } from "@/lib/email-account-types";
import { isDeliveryStatusNotification } from "@/lib/email/detect-hard-bounce";
import { fetchImapBodiesServer } from "@/lib/email/imap-fetch-bodies-server";
import { inboundToLeadMailUpsert } from "@/lib/email/lead-mail-map";
import { leadMailProviderKey } from "@/lib/email/lead-mail-ids";
import {
  leadMailDocId,
  upsertLeadMailMessagesServer,
} from "@/lib/email/lead-mail-store-server";
import { classifyInboundLeadMailServer } from "@/lib/email/classify-inbound-reply-server";
import { getEmailAccountMetaServer } from "@/lib/email/mailbox-profiles-server";
import { extractEmailAddress } from "@/lib/email/parse-outbound-recipients";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";

/** Cap body downloads for lead-matched mail per mailbox per cron tick. */
const MAX_LEAD_MAIL_BODIES_PER_MAILBOX = 35;
/** Cap lead writes per tick even for heads-only. */
const MAX_LEAD_MAIL_UPSERTS_PER_MAILBOX = 80;

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function resolveLeadIdsByContactEmails(
  organizationId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const db = getAdminDb();
  const map = new Map<string, string>();
  if (!db || emails.length === 0) return map;

  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];

  for (const chunk of chunkArray(unique, 10)) {
    const snap = await db
      .collection(COLLECTIONS.leads)
      .where("organizationId", "==", organizationId)
      .where("contactEmail", "in", chunk)
      .limit(30)
      .get();
    for (const doc of snap.docs) {
      const email = String(doc.data().contactEmail ?? "")
        .trim()
        .toLowerCase();
      if (email && !map.has(email)) map.set(email, doc.id);
    }
  }

  const missing = unique.filter((e) => !map.has(e));
  for (const chunk of chunkArray(missing, 10)) {
    if (chunk.length === 0) continue;
    const [byEmail, byPersonal] = await Promise.all([
      db
        .collection(COLLECTIONS.contacts)
        .where("organizationId", "==", organizationId)
        .where("email", "in", chunk)
        .limit(30)
        .get(),
      db
        .collection(COLLECTIONS.contacts)
        .where("organizationId", "==", organizationId)
        .where("personalEmail", "in", chunk)
        .limit(30)
        .get(),
    ]);

    const contactEmailToId = new Map<string, string>();
    for (const doc of [...byEmail.docs, ...byPersonal.docs]) {
      const data = doc.data();
      const email = String(data.email ?? "")
        .trim()
        .toLowerCase();
      const personal = String(data.personalEmail ?? "")
        .trim()
        .toLowerCase();
      if (email) contactEmailToId.set(email, doc.id);
      if (personal) contactEmailToId.set(personal, doc.id);
    }

    for (const email of chunk) {
      const contactId = contactEmailToId.get(email);
      if (!contactId) continue;
      const leadSnap = await db
        .collection(COLLECTIONS.leads)
        .where("organizationId", "==", organizationId)
        .where("contactId", "==", contactId)
        .limit(1)
        .get();
      if (!leadSnap.empty) map.set(email, leadSnap.docs[0]!.id);
    }
  }

  return map;
}

export type FanoutInboxToLeadMailResult = {
  matched: number;
  written: number;
  bodiesFetched: number;
  skipped: number;
  classified: number;
};

/**
 * After cron inbox head sync: match envelopes to leads, fetch bodies for new
 * matches, and persist under leadMailMessages so the Emails tab does not wait on IMAP.
 */
export async function fanoutInboxHeadsToLeadMailServer(input: {
  organizationId: string;
  dataOwnerUid: string;
  mailboxId: string;
  messages: MailInbound[];
  imap: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    accessToken?: string;
  };
}): Promise<FanoutInboxToLeadMailResult> {
  const result: FanoutInboxToLeadMailResult = {
    matched: 0,
    written: 0,
    bodiesFetched: 0,
    skipped: 0,
    classified: 0,
  };

  const db = getAdminDb();
  const candidates = input.messages.filter((m) => !isDeliveryStatusNotification(m));
  if (candidates.length === 0 || !db) return result;

  const meta = await getEmailAccountMetaServer({
    organizationId: input.organizationId,
    uid: input.dataOwnerUid,
  });
  const linked = meta.linkedLeadByMessageId ?? {};

  const fromEmails = new Set<string>();
  for (const message of candidates) {
    const from = extractEmailAddress(message.from);
    if (from) fromEmails.add(from);
  }
  const emailToLead = await resolveLeadIdsByContactEmails(input.organizationId, [...fromEmails]);

  type Matched = { message: MailInbound; leadId: string; providerKey: string };
  const matched: Matched[] = [];

  for (const message of candidates) {
    const mid = `${input.mailboxId}:in:${message.id}`;
    const manual = linked[mid]?.trim();
    const from = extractEmailAddress(message.from);
    const leadId = manual || (from ? emailToLead.get(from) : undefined);
    if (!leadId) {
      result.skipped += 1;
      continue;
    }
    matched.push({
      message,
      leadId,
      providerKey: leadMailProviderKey({
        mailboxId: input.mailboxId,
        direction: "inbound",
        localId: message.id,
      }),
    });
  }

  result.matched = matched.length;
  if (matched.length === 0) return result;

  matched.sort((a, b) => b.message.date.localeCompare(a.message.date));
  const limited = matched.slice(0, MAX_LEAD_MAIL_UPSERTS_PER_MAILBOX);

  const alreadySynced = new Set<string>();
  for (const group of chunkArray(limited, 100)) {
    const refs = group.map((row) =>
      db.collection(COLLECTIONS.leadMailMessages).doc(leadMailDocId(row.leadId, row.providerKey)),
    );
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, index) => {
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown>;
      if (data.bodySynced === true) {
        alreadySynced.add(group[index]!.providerKey);
      }
    });
  }

  const needsBody = limited.filter((row) => {
    if (alreadySynced.has(row.providerKey)) return false;
    if (
      row.message.bodySynced !== false &&
      (row.message.bodyText?.trim() || row.message.bodyHtml?.trim())
    ) {
      return false;
    }
    return true;
  });

  const toFetch = needsBody.slice(0, MAX_LEAD_MAIL_BODIES_PER_MAILBOX);
  let bodyByUid = new Map<number, Awaited<ReturnType<typeof fetchImapBodiesServer>>[number]>();
  if (toFetch.length > 0) {
    try {
      const updates = await fetchImapBodiesServer({
        host: input.imap.host,
        port: input.imap.port,
        secure: input.imap.secure,
        user: input.imap.user,
        pass: input.imap.pass,
        accessToken: input.imap.accessToken,
        folder: "inbox",
        uids: toFetch.map((r) => r.message.uid),
        maxUids: MAX_LEAD_MAIL_BODIES_PER_MAILBOX,
      });
      bodyByUid = new Map(updates.map((u) => [u.uid, u]));
      result.bodiesFetched = updates.length;
    } catch {
      /* heads still useful without bodies */
    }
  }

  const byLead = new Map<string, ReturnType<typeof inboundToLeadMailUpsert>[]>();
  for (const row of limited) {
    const body = bodyByUid.get(row.message.uid);
    const message: MailInbound = body
      ? {
          ...row.message,
          preview: body.preview || row.message.preview,
          bodyText: body.bodyText,
          bodyHtml: body.bodyHtml,
          ...(body.cc ? { cc: body.cc } : {}),
          ...(body.replyTo ? { replyTo: body.replyTo } : {}),
          ...(body.messageId ? { messageId: body.messageId } : {}),
          ...(body.inReplyTo ? { inReplyTo: body.inReplyTo } : {}),
          ...(body.referenceIds?.length ? { referenceIds: body.referenceIds } : {}),
          bodySynced: body.bodySynced,
        }
      : row.message;

    const upsert = inboundToLeadMailUpsert(input.mailboxId, message, "imap", input.dataOwnerUid);
    const list = byLead.get(row.leadId) ?? [];
    list.push(upsert);
    byLead.set(row.leadId, list);
  }

  for (const [leadId, messages] of byLead) {
    const { written } = await upsertLeadMailMessagesServer({
      organizationId: input.organizationId,
      leadId,
      mailboxOwnerUid: input.dataOwnerUid,
      messages,
    });
    result.written += written;
    if (written > 0) {
      try {
        const classify = await classifyInboundLeadMailServer({
          organizationId: input.organizationId,
          leadId,
          messages,
          actorUid: input.dataOwnerUid,
        });
        result.classified += classify.classified;
      } catch {
        /* mail persist succeeded; classify retries next tick / open */
      }
    }
  }

  return result;
}
