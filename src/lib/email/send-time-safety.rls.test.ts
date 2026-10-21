/**
 * QA 1.5 — email safety at send time (SEND-08, MBX-06, LEAD-12).
 * Suppressed recipients and disabled mailboxes are never sent to on either
 * scheduled path, and deleting a lead cancels its pending scheduled mail.
 * Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getAdminDb } from "@/lib/db/document-access/admin";
import { deleteCrmEntityPostgres, upsertLeadGraphPostgres } from "@/lib/db/crm-write-postgres";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { updateDocument } from "@/lib/db/document-shim/store";
import { getLeadFromPostgres } from "@/lib/db/list-crm-postgres";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import {
  cancelPendingScheduledEmailsForLeadServer,
  processDueScheduledEmailsForMemberServer,
} from "@/lib/email/scheduled-emails-server";
import { claimDueBatch, getScheduledEmailById, insertScheduledEmail } from "@/lib/email/scheduled-emails-repo";
import { sendClaimedScheduledEmailPg } from "@/lib/email/send-claimed-scheduled-email-pg";
import { addSuppression } from "@/lib/email/suppression-server";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-15-email";
const UID = "qa15-owner";
const OFF = "mb-qa15-off";
const ON = "mb-qa15-on";
const now = "2026-10-21T00:00:00.000Z";
const past = () => new Date(Date.now() - 60_000).toISOString();

function memberRoot() {
  return getAdminDb()!
    .collection(COLLECTIONS.organizations)
    .doc(ORG)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(UID);
}

function scheduledDoc(id: string) {
  return memberRoot().collection("scheduledEmails").doc(id);
}

async function writeMailbox(id: string, enabled: boolean) {
  await memberRoot().collection("emailMailboxes").doc(id).set({
    label: id, enabled, displayName: "QA", emailAddress: `${id}@nova.test`, replyTo: "",
    // Unroutable on purpose: a regression would fail to connect, never deliver.
    smtpHost: "127.0.0.1", smtpPort: 1, smtpSecure: false,
    imapHost: "", imapPort: 993, imapSecure: false,
    connectionType: "custom", dailySendLimit: null, sendGapSeconds: 0, assignedUserIds: [],
  });
}

async function writeScheduled(id: string, mailboxId: string, to: string, extra: Record<string, unknown> = {}) {
  await scheduledDoc(id).set({
    organizationId: ORG, uid: UID, mailboxId, status: "pending", scheduledAt: past(),
    to, from: `${mailboxId}@nova.test`, subject: "QA 1.5", body: "hi", text: "hi",
    attempts: 0, createdAt: now, updatedAt: now, ...extra,
  });
}

async function cleanup() {
  await withRlsBypass(async (tx) => {
    await tx.scheduledEmailRow.deleteMany({ where: { organizationId: ORG } });
    await tx.mailboxSendState.deleteMany({ where: { organizationId: ORG } });
    await tx.emailSuppression.deleteMany({ where: { organizationId: ORG } });
    await tx.lead.deleteMany({ where: { organizationId: ORG } });
    await tx.contact.deleteMany({ where: { organizationId: ORG } });
    await tx.account.deleteMany({ where: { organizationId: ORG } });
    await tx.pgDocument.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
}

describe.skipIf(!runDb)("send-time email safety (QA 1.5)", () => {
  const prevFlag = process.env.SCHEDULED_EMAIL_PG_V1;

  beforeAll(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 1.5", slug: "qa-15-email", status: "active", planId: "free",
          seatsUsed: 1, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
    await writeMailbox(OFF, false);
    await writeMailbox(ON, true);
    await addSuppression({ organizationId: ORG, email: "gone@nova.test", reason: "unsubscribe" });
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.SCHEDULED_EMAIL_PG_V1;
    else process.env.SCHEDULED_EMAIL_PG_V1 = prevFlag;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  });

  it("legacy path: disabled mailbox is cancelled, not sent (MBX-06)", async () => {
    process.env.SCHEDULED_EMAIL_PG_V1 = "false";
    await writeScheduled("qa15-legacy-off", OFF, "ok@nova.test");
    const res = await processDueScheduledEmailsForMemberServer({ organizationId: ORG, uid: UID });
    expect(res.sent).toBe(0);
    const data = (await scheduledDoc("qa15-legacy-off").get()).data()!;
    expect(data.status).toBe("cancelled");
    expect(data.lastSkipReason).toBe("mailbox_disabled");
  });

  it("legacy path: suppressed recipient is cancelled, not sent (SEND-08)", async () => {
    process.env.SCHEDULED_EMAIL_PG_V1 = "false";
    await writeScheduled("qa15-legacy-supp", ON, "Gone@nova.test");
    const res = await processDueScheduledEmailsForMemberServer({ organizationId: ORG, uid: UID });
    expect(res.sent).toBe(0);
    const data = (await scheduledDoc("qa15-legacy-supp").get()).data()!;
    expect(data.status).toBe("cancelled");
    expect(data.lastSkipReason).toBe("suppressed");
  });

  it("relational path: disabled mailbox is cancelled, not sent (MBX-06)", async () => {
    const created = await insertScheduledEmail({
      organizationId: ORG, mailboxOwnerUid: UID, mailboxId: OFF, scheduledAt: new Date(past()),
      toEmail: "ok@nova.test", fromEmail: `${OFF}@nova.test`, subject: "QA 1.5",
      payload: { body: "hi", text: "hi" },
    });
    expect(created).toMatchObject({ ok: true });
    const id = (created as { id: string }).id;
    const claimed = await claimDueBatch({ limit: 10, organizationId: ORG, mailboxOwnerUid: UID, defaultGapSeconds: 0 });
    const mine = claimed.find((r) => r.id === id);
    expect(mine).toBeTruthy();
    const out = await sendClaimedScheduledEmailPg({ organizationId: ORG, id, leaseId: mine!.leaseId });
    expect(out).toMatchObject({ outcome: "skipped", reason: "mailbox_disabled" });
    const row = await getScheduledEmailById({ organizationId: ORG, id });
    expect(row?.status).toBe("cancelled");
  });

  it("deleting a lead cancels its pending mail and removes the stale document copy (LEAD-12)", async () => {
    process.env.SCHEDULED_EMAIL_PG_V1 = "false";
    await upsertLeadGraphPostgres(ORG, {
      account: { id: "a-qa15", doc: { name: "Co", ownerId: UID, createdAt: now, updatedAt: now } },
      contact: { id: "ct-qa15", doc: { firstName: "C", lastName: "Q", fullName: "C Q", accountId: "a-qa15", ownerId: UID, createdAt: now, updatedAt: now } },
      lead: {
        id: "l-qa15",
        doc: {
          accountId: "a-qa15", contactId: "ct-qa15", companyName: "Co", contactName: "C Q",
          channel: "cold_email", stage: "new", temperature: "cold", priority: "medium",
          ownerId: UID, touches: 0, isIdle: false, createdAt: now, updatedAt: now,
        },
      },
    });
    // The document copy that reads fall back to after the table row is gone.
    await getAdminDb()!.collection(COLLECTIONS.leads).doc("l-qa15").set({ organizationId: ORG, ownerId: UID });
    await writeScheduled("qa15-lead-mail", ON, "lead@nova.test", { leadId: "l-qa15", scheduledAt: "2099-01-01T00:00:00.000Z" });

    const del = await deleteCrmEntityPostgres(ORG, "lead", "l-qa15", {});
    expect(del.ok).toBe(true);
    const copy = await withRlsBypass((tx) =>
      tx.pgDocument.findFirst({ where: { path: `${COLLECTIONS.leads}/l-qa15` } }),
    );
    expect(copy).toBeNull();

    const n = await cancelPendingScheduledEmailsForLeadServer({ organizationId: ORG, leadId: "l-qa15", reason: "Lead deleted" });
    expect(n).toBe(1);
    expect((await scheduledDoc("qa15-lead-mail").get()).data()!.status).toBe("cancelled");

    // A late post-send update (open pixel, touch bump) must not bring the lead back.
    await updateDocument(`${COLLECTIONS.leads}/l-qa15`, { organizationId: ORG, lastActivityAt: now });
    expect(await getLeadFromPostgres(ORG, "l-qa15")).toBeNull();
    const revived = await withRlsBypass((tx) =>
      tx.pgDocument.findFirst({ where: { path: `${COLLECTIONS.leads}/l-qa15` } }),
    );
    expect(revived).toBeNull();
  });
});
