import type { MailInbound } from "@/lib/email-account-types";
import { isDeliveryStatusNotification } from "@/lib/email/detect-hard-bounce";
import type { ImapBodyUpdate } from "@/lib/email/imap-fetch-bodies-server";
import { fetchImapBodiesServer } from "@/lib/email/imap-fetch-bodies-server";
import { readInboxHeadsServer } from "@/lib/email/inbox-heads-server";
import { inboundToLeadMailUpsert } from "@/lib/email/lead-mail-map";
import { leadMailProviderKey } from "@/lib/email/lead-mail-ids";
import {
  leadMailDocId,
  upsertLeadMailMessagesServer,
} from "@/lib/email/lead-mail-store-server";
import { classifyInboundLeadMailServer } from "@/lib/email/classify-inbound-reply-server";
import { getEmailAccountMetaServer } from "@/lib/email/mailbox-profiles-server";
import { extractEmailAddress } from "@/lib/email/parse-outbound-recipients";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { findLeadIdsByContactEmailsPostgres } from "@/lib/db/list-crm-postgres";

/** Cap body downloads for lead-matched mail per mailbox per cron tick. */
const MAX_LEAD_MAIL_BODIES_PER_MAILBOX = 80;
/** Cap lead writes per tick for messages that still need persistence / body fill. */
const MAX_LEAD_MAIL_UPSERTS_PER_MAILBOX = 120;
/** How many newest lead-matched heads to inspect for bodySynced state. */
const MAX_LEAD_MAIL_SYNC_CHECK = 250;

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function applyBodyUpdate(head: MailInbound, body: ImapBodyUpdate): MailInbound {
  return {
    ...head,
    preview: body.preview || head.preview,
    bodyText: body.bodyText,
    bodyHtml: body.bodyHtml,
    ...(body.cc ? { cc: body.cc } : {}),
    ...(body.replyTo ? { replyTo: body.replyTo } : {}),
    ...(body.messageId ? { messageId: body.messageId } : {}),
    ...(body.inReplyTo ? { inReplyTo: body.inReplyTo } : {}),
    ...(body.referenceIds?.length ? { referenceIds: body.referenceIds } : {}),
    ...(body.attachments !== undefined ? { attachments: body.attachments } : {}),
    bodySynced: body.bodySynced,
  };
}

function messageHasInlineBody(message: MailInbound): boolean {
  return (
    message.bodySynced !== false &&
    Boolean(message.bodyText?.trim() || message.bodyHtml?.trim())
  );
}

async function resolveLeadIdsByContactEmails(
  organizationId: string,
  emails: string[],
): Promise<Map<string, string>> {
  // CRM sole-writer: live leads/contacts live in Prisma tables. Document-shim
  // collection queries only see leftover pg_documents rows (~few hundred) and
  // miss almost all matches — which left Reply intelligence empty.
  return findLeadIdsByContactEmailsPostgres(organizationId, emails);
}

type MatchedInbound = { message: MailInbound; leadId: string; providerKey: string };

async function matchInboundToLeads(input: {
  organizationId: string;
  dataOwnerUid: string;
  mailboxId: string;
  messages: MailInbound[];
}): Promise<{ matched: MatchedInbound[]; skipped: number }> {
  const candidates = input.messages.filter((m) => !isDeliveryStatusNotification(m));
  if (candidates.length === 0) return { matched: [], skipped: 0 };

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

  const matched: MatchedInbound[] = [];
  let skipped = 0;

  for (const message of candidates) {
    const mid = `${input.mailboxId}:in:${message.id}`;
    const manual = linked[mid]?.trim();
    const from = extractEmailAddress(message.from);
    const leadId = manual || (from ? emailToLead.get(from) : undefined);
    if (!leadId) {
      skipped += 1;
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

  matched.sort((a, b) => b.message.date.localeCompare(a.message.date));
  return { matched, skipped };
}

async function loadBodySyncedKeys(rows: MatchedInbound[]): Promise<Set<string>> {
  const db = getAdminDb();
  const alreadySynced = new Set<string>();
  if (!db || rows.length === 0) return alreadySynced;

  for (const group of chunkArray(rows, 100)) {
    const refs = group.map((row) =>
      db.collection(COLLECTIONS.leadMailMessages).doc(leadMailDocId(row.leadId, row.providerKey)),
    );
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, index) => {
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown>;
      if (data.bodySynced === true) alreadySynced.add(group[index]!.providerKey);
    });
  }

  return alreadySynced;
}

async function writeMatchedLeadMail(input: {
  organizationId: string;
  dataOwnerUid: string;
  mailboxId: string;
  rows: MatchedInbound[];
  source: "imap" | "client_sync";
}): Promise<{ written: number; classified: number }> {
  let written = 0;
  let classified = 0;
  if (input.rows.length === 0) return { written, classified };

  const byLead = new Map<string, ReturnType<typeof inboundToLeadMailUpsert>[]>();
  for (const row of input.rows) {
    const upsert = inboundToLeadMailUpsert(
      input.mailboxId,
      row.message,
      input.source,
      input.dataOwnerUid,
    );
    const list = byLead.get(row.leadId) ?? [];
    list.push(upsert);
    byLead.set(row.leadId, list);
  }

  for (const [leadId, messages] of byLead) {
    const result = await upsertLeadMailMessagesServer({
      organizationId: input.organizationId,
      leadId,
      mailboxOwnerUid: input.dataOwnerUid,
      messages,
    });
    written += result.written;
    if (result.written > 0) {
      try {
        const classify = await classifyInboundLeadMailServer({
          organizationId: input.organizationId,
          leadId,
          messages,
          actorUid: input.dataOwnerUid,
        });
        classified += classify.classified;
      } catch {
        /* mail persist succeeded; classify retries next tick / open */
      }
    }
  }

  return { written, classified };
}

export type FanoutInboxToLeadMailResult = {
  matched: number;
  written: number;
  bodiesFetched: number;
  skipped: number;
  classified: number;
};

/**
 * After cron inbox head sync: match envelopes to leads, fetch bodies for unsynced
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
  if (!db) return result;

  const { matched, skipped } = await matchInboundToLeads(input);
  result.matched = matched.length;
  result.skipped = skipped;
  if (matched.length === 0) {
    if (skipped > 0) {
      console.info("[lead-mail-fanout] no lead matches", {
        organizationId: input.organizationId,
        mailboxId: input.mailboxId,
        candidates: skipped,
      });
    }
    return result;
  }

  const toCheck = matched.slice(0, MAX_LEAD_MAIL_SYNC_CHECK);
  const alreadySynced = await loadBodySyncedKeys(toCheck);

  // Prefer messages that still need a durable body over already-complete rows.
  const needsWork = toCheck.filter((row) => {
    if (alreadySynced.has(row.providerKey)) return false;
    return true;
  });
  if (needsWork.length === 0) return result;

  const toUpsert = needsWork.slice(0, MAX_LEAD_MAIL_UPSERTS_PER_MAILBOX);
  const needsBodyFetch = toUpsert.filter((row) => !messageHasInlineBody(row.message));
  const toFetch = needsBodyFetch.slice(0, MAX_LEAD_MAIL_BODIES_PER_MAILBOX);

  let bodyByUid = new Map<number, ImapBodyUpdate>();
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
      /* heads still useful without bodies — next tick retries body fill */
    }
  }

  const rowsWithBodies: MatchedInbound[] = toUpsert.map((row) => {
    const body = bodyByUid.get(row.message.uid);
    if (!body) return row;
    return { ...row, message: applyBodyUpdate(row.message, body) };
  });

  const write = await writeMatchedLeadMail({
    organizationId: input.organizationId,
    dataOwnerUid: input.dataOwnerUid,
    mailboxId: input.mailboxId,
    rows: rowsWithBodies,
    source: "imap",
  });
  result.written = write.written;
  result.classified = write.classified;
  console.info("[lead-mail-fanout] done", {
    organizationId: input.organizationId,
    mailboxId: input.mailboxId,
    matched: result.matched,
    skipped: result.skipped,
    written: result.written,
    classified: result.classified,
    bodiesFetched: result.bodiesFetched,
  });

  return result;
}

export type PersistImapBodiesToLeadMailResult = {
  matched: number;
  written: number;
  classified: number;
};

function bodyUpdateToMailInbound(
  update: ImapBodyUpdate,
  head?: MailInbound | null,
): MailInbound | null {
  const from = update.from?.trim() || head?.from?.trim() || "";
  if (!from) return null;
  const uid = update.uid;
  const subject = update.subject?.trim() || head?.subject || "(no subject)";
  const to = update.to?.trim() || head?.to || "";
  const date = update.date || head?.date || new Date().toISOString();
  const base: MailInbound = head
    ? applyBodyUpdate(head, update)
    : {
        id: `uid-${uid}`,
        uid,
        subject,
        from,
        to,
        date,
        seen: update.seen ?? true,
        preview: update.preview || subject,
        bodyText: update.bodyText,
        bodySynced: update.bodySynced,
      };

  return {
    ...base,
    subject,
    from,
    to,
    date,
    ...(update.cc || base.cc ? { cc: update.cc || base.cc } : {}),
    ...(update.replyTo || base.replyTo ? { replyTo: update.replyTo || base.replyTo } : {}),
    ...(update.messageId || base.messageId
      ? { messageId: update.messageId || base.messageId }
      : {}),
    ...(update.inReplyTo || base.inReplyTo
      ? { inReplyTo: update.inReplyTo || base.inReplyTo }
      : {}),
    ...((update.referenceIds?.length ? update.referenceIds : base.referenceIds)?.length
      ? {
          referenceIds: update.referenceIds?.length ? update.referenceIds : base.referenceIds,
        }
      : {}),
    preview: update.preview || base.preview || subject,
    bodyText: update.bodyText || base.bodyText,
    ...(update.bodyHtml || base.bodyHtml ? { bodyHtml: update.bodyHtml || base.bodyHtml } : {}),
    ...(update.attachments !== undefined
      ? { attachments: update.attachments }
      : base.attachments !== undefined
        ? { attachments: base.attachments }
        : {}),
    bodySynced: update.bodySynced,
  };
}

/**
 * When IMAP bodies are fetched (Inbox thread open, bounce watcher, etc.), match leads
 * and persist full messages into leadMailMessages. Uses envelope fields on the body
 * update when present; falls back to cron inbox heads for older clients.
 */
export async function persistImapBodiesToLeadMailServer(input: {
  organizationId: string;
  dataOwnerUid: string;
  mailboxId: string;
  /** Only inbox replies are matched/persisted here. */
  folder: "inbox" | "sent" | "trash";
  updates: ImapBodyUpdate[];
}): Promise<PersistImapBodiesToLeadMailResult> {
  const empty: PersistImapBodiesToLeadMailResult = { matched: 0, written: 0, classified: 0 };
  if (input.folder !== "inbox" || input.updates.length === 0) return empty;
  if (!getAdminDb()) return empty;

  const heads = await readInboxHeadsServer({
    organizationId: input.organizationId,
    uid: input.dataOwnerUid,
    mailboxId: input.mailboxId,
  });
  const headByUid = new Map(heads.messages.map((m) => [m.uid, m]));

  const enriched: MailInbound[] = [];
  for (const update of input.updates) {
    const message = bodyUpdateToMailInbound(update, headByUid.get(update.uid) ?? null);
    if (message) enriched.push(message);
  }
  if (enriched.length === 0) return empty;

  const { matched } = await matchInboundToLeads({
    organizationId: input.organizationId,
    dataOwnerUid: input.dataOwnerUid,
    mailboxId: input.mailboxId,
    messages: enriched,
  });
  if (matched.length === 0) return { ...empty, matched: 0 };

  const write = await writeMatchedLeadMail({
    organizationId: input.organizationId,
    dataOwnerUid: input.dataOwnerUid,
    mailboxId: input.mailboxId,
    rows: matched,
    source: "client_sync",
  });

  return {
    matched: matched.length,
    written: write.written,
    classified: write.classified,
  };
}
