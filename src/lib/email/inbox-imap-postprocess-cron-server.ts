import { resolveMailboxTransportAuthServer } from "@/lib/email/resolve-mailbox-transport-auth";
import { readInboxHeadsServer } from "@/lib/email/inbox-heads-server";
import { processInboxBouncesFromHeadsServer } from "@/lib/email/process-inbox-bounces-server";
import { fanoutInboxHeadsToLeadMailServer } from "@/lib/email/fanout-inbox-to-lead-mail-server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";

export type PostprocessMailbox = {
  organizationId: string;
  uid: string;
  mailboxId: string;
};

export type InboxImapPostprocessResult = {
  mailboxes: number;
  bouncesApplied: number;
  bounceCandidates: number;
  leadMailWritten: number;
  leadMailMatched: number;
  errors: Array<{ organizationId: string; mailboxId: string; error: string }>;
};

async function loadMailboxImapMeta(mb: PostprocessMailbox): Promise<{
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
} | null> {
  const db = getAdminDb();
  if (!db) return null;
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(mb.organizationId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(mb.uid)
    .collection("emailMailboxes")
    .doc(mb.mailboxId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const imapHost = normalizeMailHost(String(data.imapHost ?? ""));
  if (!imapHost) return null;
  return {
    imapHost,
    imapPort: Number(data.imapPort ?? 993) || 993,
    imapSecure: data.imapSecure !== false,
  };
}

/**
 * Bounce apply + lead-mail fanout for mailboxes whose heads were just synced
 * on Cloud Functions (P1.2). Reads stored heads; may open IMAP only for small
 * body batches (DSN / lead matches) — not the full 800-head fetch.
 */
export async function runInboxImapPostprocessCronServer(
  mailboxes: PostprocessMailbox[],
): Promise<InboxImapPostprocessResult> {
  let bouncesApplied = 0;
  let bounceCandidates = 0;
  let leadMailWritten = 0;
  let leadMailMatched = 0;
  const errors: InboxImapPostprocessResult["errors"] = [];

  for (const mb of mailboxes) {
    try {
      const meta = await loadMailboxImapMeta(mb);
      if (!meta) continue;

      const auth = await resolveMailboxTransportAuthServer({
        organizationId: mb.organizationId,
        uid: mb.uid,
        mailboxId: mb.mailboxId,
        prefer: "imap",
      });
      if (!auth.accessToken && !auth.pass) continue;

      const heads = await readInboxHeadsServer(mb);
      if (heads.messages.length === 0) continue;

      const imapCreds = {
        host: meta.imapHost,
        port: meta.imapPort,
        secure: meta.imapSecure,
        user: auth.user,
        pass: auth.pass,
        accessToken: auth.accessToken,
      };

      try {
        const bounceResult = await processInboxBouncesFromHeadsServer({
          organizationId: mb.organizationId,
          dataOwnerUid: mb.uid,
          mailboxId: mb.mailboxId,
          messages: heads.messages,
          imap: imapCreds,
        });
        bouncesApplied += bounceResult.applied;
        bounceCandidates += bounceResult.candidates;
      } catch {
        /* heads already durable; bounce retries next tick */
      }

      try {
        const fanout = await fanoutInboxHeadsToLeadMailServer({
          organizationId: mb.organizationId,
          dataOwnerUid: mb.uid,
          mailboxId: mb.mailboxId,
          messages: heads.messages,
          imap: imapCreds,
        });
        leadMailWritten += fanout.written;
        leadMailMatched += fanout.matched;
      } catch {
        /* heads already durable; fan-out retries next tick */
      }
    } catch (e) {
      errors.push({
        organizationId: mb.organizationId,
        mailboxId: mb.mailboxId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    mailboxes: mailboxes.length,
    bouncesApplied,
    bounceCandidates,
    leadMailWritten,
    leadMailMatched,
    errors: errors.slice(0, 20),
  };
}
