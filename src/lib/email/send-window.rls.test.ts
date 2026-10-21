/**
 * QA 3.5 — scheduled mail due outside the workspace's saved send window is
 * kept pending until the window opens (no send, no attempt used) on both the
 * legacy and relational paths (SEND-06). Skips when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAdminDb } from "@/lib/db/document-access/admin";
import { coerceInstantMs } from "@/lib/db/document-shim/timestamp";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { processDueScheduledEmailsForMemberServer } from "@/lib/email/scheduled-emails-server";
import { claimDueBatch, getScheduledEmailById, insertScheduledEmail } from "@/lib/email/scheduled-emails-repo";
import { sendClaimedScheduledEmailPg } from "@/lib/email/send-claimed-scheduled-email-pg";
import { sendWindowDeferUntilServer } from "@/lib/email/send-window-server";
import { WEEKDAY_KEYS } from "@/lib/scheduling/defaults";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-35-window";
const NOPOLICY = "test-org-qa-35-nopolicy";
const UID = "qa35-owner";
const MB = "mb-qa35";
const now = "2026-10-21T00:00:00.000Z";

// A one-minute window tomorrow (UTC), so "now" is always outside it.
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
const tomorrowKey = WEEKDAY_KEYS[tomorrow.getUTCDay()]!;
const weekly = Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, k === tomorrowKey ? [{ start: "03:00", end: "03:01" }] : []]));
const expectedOpen = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 3, 0));

async function cleanup() {
  await withRlsBypass(async (tx) => {
    for (const org of [ORG, NOPOLICY]) {
      await tx.scheduledEmailRow.deleteMany({ where: { organizationId: org } });
      await tx.mailboxSendState.deleteMany({ where: { organizationId: org } });
      await tx.pgDocument.deleteMany({ where: { organizationId: org } });
      await tx.organization.deleteMany({ where: { id: org } });
    }
  });
}

describe.skipIf(!runDb)("send window enforced at send time (QA 3.5)", () => {
  const prevFlag = process.env.SCHEDULED_EMAIL_PG_V1;

  beforeAll(async () => {
    await cleanup();
    await withRlsBypass(async (tx) => {
      await tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 3.5", slug: "qa-35-window", status: "active", planId: "free", seatsUsed: 1,
          settings: { timezone: "UTC", sendPolicy: { weekly, weekdayOnly: true, dailyCeiling: null } },
          createdAt: now, updatedAt: now,
        } as never),
      });
      await tx.organization.create({
        data: organizationToPrismaRow({
          id: NOPOLICY, name: "QA 3.5b", slug: "qa-35-nopolicy", status: "active", planId: "free", seatsUsed: 1,
          settings: { timezone: "UTC" }, createdAt: now, updatedAt: now,
        } as never),
      });
    });
    await getAdminDb()!
      .collection(COLLECTIONS.organizations).doc(ORG)
      .collection(ORG_SUBCOLLECTIONS.members).doc(UID)
      .collection("emailMailboxes").doc(MB)
      .set({
        label: MB, enabled: true, displayName: "QA", emailAddress: "qa35@nova.test", replyTo: "",
        smtpHost: "127.0.0.1", smtpPort: 1, smtpSecure: false, imapHost: "", imapPort: 993, imapSecure: false,
        connectionType: "custom", dailySendLimit: null, sendGapSeconds: 0, assignedUserIds: [],
      });
  }, 60_000);

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.SCHEDULED_EMAIL_PG_V1;
    else process.env.SCHEDULED_EMAIL_PG_V1 = prevFlag;
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  }, 60_000);

  it("only workspaces with a saved window are restricted", async () => {
    expect((await sendWindowDeferUntilServer(ORG))?.toISOString()).toBe(expectedOpen.toISOString());
    expect(await sendWindowDeferUntilServer(NOPOLICY)).toBeNull();
  });

  it("legacy path keeps the email pending until the window opens", async () => {
    process.env.SCHEDULED_EMAIL_PG_V1 = "false";
    const ref = getAdminDb()!
      .collection(COLLECTIONS.organizations).doc(ORG)
      .collection(ORG_SUBCOLLECTIONS.members).doc(UID)
      .collection("scheduledEmails").doc("qa35-legacy");
    await ref.set({
      organizationId: ORG, uid: UID, mailboxId: MB, status: "pending",
      scheduledAt: new Date(Date.now() - 60_000).toISOString(), to: "lead@nova.test",
      from: "qa35@nova.test", subject: "QA 3.5", body: "hi", text: "hi", attempts: 0, createdAt: now, updatedAt: now,
    });
    const res = await processDueScheduledEmailsForMemberServer({ organizationId: ORG, uid: UID });
    expect(res.sent).toBe(0);
    const data = (await ref.get()).data()!;
    expect(data).toMatchObject({ status: "pending", lastSkipReason: "send_window", attempts: 0 });
    expect(coerceInstantMs(data.notBeforeAt)).toBe(expectedOpen.getTime());
  });

  it("relational path releases the claim back to pending with notBeforeAt", async () => {
    const created = await insertScheduledEmail({
      organizationId: ORG, mailboxOwnerUid: UID, mailboxId: MB, scheduledAt: new Date(Date.now() - 60_000),
      toEmail: "lead@nova.test", fromEmail: "qa35@nova.test", subject: "QA 3.5", payload: { body: "hi", text: "hi" },
    });
    const id = (created as { id: string }).id;
    const claimed = (await claimDueBatch({ limit: 10, organizationId: ORG, mailboxOwnerUid: UID, defaultGapSeconds: 0 })).find((r) => r.id === id)!;
    const out = await sendClaimedScheduledEmailPg({ organizationId: ORG, id, leaseId: claimed.leaseId });
    expect(out).toMatchObject({ outcome: "skipped", reason: "send_window" });
    const row = await getScheduledEmailById({ organizationId: ORG, id });
    expect(row?.status).toBe("pending");
    expect(row?.attempts ?? 0).toBe(0);
  });
});
