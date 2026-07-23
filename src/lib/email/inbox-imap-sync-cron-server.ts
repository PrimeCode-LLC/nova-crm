import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { listOrganizationsServer } from "@/lib/platform/organizations-server";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { resolveMailboxTransportAuthServer } from "@/lib/email/resolve-mailbox-transport-auth";
import {
  fetchImapFolderServer,
  IMAP_CRON_HEAD_LIMIT,
  toImapFetchErrorMessage,
} from "@/lib/email/imap-fetch-folder-server";
import {
  markInboxSyncErrorServer,
  writeInboxHeadsServer,
} from "@/lib/email/inbox-heads-server";
import { processInboxBouncesFromHeadsServer } from "@/lib/email/process-inbox-bounces-server";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";

/** Cap IMAP connects per cron tick (cost + duration). */
const MAX_MAILBOXES_PER_TICK = 12;
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;

type DueMailbox = {
  organizationId: string;
  uid: string;
  mailboxId: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  syncIntervalMinutes: number;
  inboxLastSyncedAt: string | null;
};

function memberRoot(orgId: string, uid: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid);
}

function isDue(lastSyncedAt: string | null, intervalMinutes: number, nowMs: number): boolean {
  if (!lastSyncedAt) return true;
  const t = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= intervalMinutes * 60_000;
}

async function listDueMailboxesForOrg(organizationId: string, nowMs: number): Promise<DueMailbox[]> {
  const users = await listOrgUsersServer(organizationId);
  const due: DueMailbox[] = [];

  await Promise.all(
    users.map(async (user) => {
      const root = memberRoot(organizationId, user.id);
      if (!root) return;
      const snap = await root.collection("emailMailboxes").get();
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (data.enabled === false) continue;
        const imapHost = normalizeMailHost(String(data.imapHost ?? ""));
        if (!imapHost) continue;
        const syncIntervalMinutes = Math.max(
          5,
          Math.min(120, Number(data.syncIntervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES) || DEFAULT_SYNC_INTERVAL_MINUTES),
        );
        const inboxLastSyncedAt = data.inboxLastSyncedAt
          ? String(data.inboxLastSyncedAt)
          : null;
        if (!isDue(inboxLastSyncedAt, syncIntervalMinutes, nowMs)) continue;
        due.push({
          organizationId,
          uid: user.id,
          mailboxId: doc.id,
          imapHost,
          imapPort: Number(data.imapPort ?? 993) || 993,
          imapSecure: data.imapSecure !== false,
          syncIntervalMinutes,
          inboxLastSyncedAt,
        });
      }
    }),
  );

  // Oldest sync first so starved mailboxes catch up across ticks.
  due.sort((a, b) => {
    const at = a.inboxLastSyncedAt ? new Date(a.inboxLastSyncedAt).getTime() : 0;
    const bt = b.inboxLastSyncedAt ? new Date(b.inboxLastSyncedAt).getTime() : 0;
    return at - bt;
  });
  return due;
}

async function syncOneMailbox(mb: DueMailbox): Promise<{
  ok: boolean;
  error?: string;
  count?: number;
  bouncesApplied?: number;
  bounceCandidates?: number;
}> {
  try {
    const auth = await resolveMailboxTransportAuthServer({
      organizationId: mb.organizationId,
      uid: mb.uid,
      mailboxId: mb.mailboxId,
      prefer: "imap",
    });
    if (!auth.accessToken && !auth.pass) {
      const error = "IMAP credentials missing";
      await markInboxSyncErrorServer({
        organizationId: mb.organizationId,
        uid: mb.uid,
        mailboxId: mb.mailboxId,
        error,
      });
      return { ok: false, error };
    }

    const result = await fetchImapFolderServer({
      host: mb.imapHost,
      port: mb.imapPort,
      secure: mb.imapSecure,
      user: auth.user,
      pass: auth.pass,
      accessToken: auth.accessToken,
      folder: "inbox",
      limit: IMAP_CRON_HEAD_LIMIT,
      offset: 0,
      headsOnly: true,
    });

    await writeInboxHeadsServer({
      organizationId: mb.organizationId,
      uid: mb.uid,
      mailboxId: mb.mailboxId,
      messages: result.messages,
      mailboxTotal: result.mailboxTotal,
    });

    // Server-side bounce apply so CRM tasks/leads update without an open browser tab.
    let bouncesApplied = 0;
    let bounceCandidates = 0;
    try {
      const bounceResult = await processInboxBouncesFromHeadsServer({
        organizationId: mb.organizationId,
        dataOwnerUid: mb.uid,
        mailboxId: mb.mailboxId,
        messages: result.messages,
        imap: {
          host: mb.imapHost,
          port: mb.imapPort,
          secure: mb.imapSecure,
          user: auth.user,
          pass: auth.pass,
          accessToken: auth.accessToken,
        },
      });
      bouncesApplied = bounceResult.applied;
      bounceCandidates = bounceResult.candidates;
    } catch {
      /* head sync succeeded; bounce apply retries next tick */
    }

    return {
      ok: true,
      count: result.messages.length,
      bouncesApplied,
      bounceCandidates,
    };
  } catch (e) {
    const error = toImapFetchErrorMessage(e);
    await markInboxSyncErrorServer({
      organizationId: mb.organizationId,
      uid: mb.uid,
      mailboxId: mb.mailboxId,
      error,
    });
    return { ok: false, error };
  }
}

export type InboxImapCronResult = {
  considered: number;
  synced: number;
  failed: number;
  skipped: number;
  bouncesApplied: number;
  bounceCandidates: number;
  errors: Array<{ organizationId: string; mailboxId: string; error: string }>;
};

/**
 * Server-side IMAP head sync for due mailboxes across active orgs.
 * Caps work per tick for cost/duration; remaining mailboxes catch up next run.
 */
export async function runInboxImapSyncCronServer(): Promise<InboxImapCronResult> {
  const nowMs = Date.now();
  const orgs = await listOrganizationsServer();
  const activeOrgs = orgs.filter((o) => o.status !== "suspended");

  const due: DueMailbox[] = [];
  for (const org of activeOrgs) {
    const orgDue = await listDueMailboxesForOrg(org.id, nowMs);
    due.push(...orgDue);
  }

  const batch = due.slice(0, MAX_MAILBOXES_PER_TICK);
  const skipped = Math.max(0, due.length - batch.length);

  let synced = 0;
  let failed = 0;
  let bouncesApplied = 0;
  let bounceCandidates = 0;
  const errors: InboxImapCronResult["errors"] = [];

  // Sequential IMAP connects - safer for provider rate limits than a fan-out.
  for (const mb of batch) {
    const result = await syncOneMailbox(mb);
    if (result.ok) {
      synced += 1;
      bouncesApplied += result.bouncesApplied ?? 0;
      bounceCandidates += result.bounceCandidates ?? 0;
    } else {
      failed += 1;
      if (result.error) {
        errors.push({
          organizationId: mb.organizationId,
          mailboxId: mb.mailboxId,
          error: result.error,
        });
      }
    }
  }

  return {
    considered: due.length,
    synced,
    failed,
    skipped,
    bouncesApplied,
    bounceCandidates,
    errors: errors.slice(0, 20),
  };
}
