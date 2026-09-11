import { describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import {
  claimDueBatch,
  insertScheduledEmail,
  reclaimExpiredLeases,
  updateScheduledEmailPg,
} from "@/lib/email/scheduled-emails-repo";
import { addSuppression, isSuppressed } from "@/lib/email/suppression-server";

const runIntegration =
  process.env.SCHEDULED_EMAIL_PG_INTEGRATION === "true" &&
  Boolean(process.env.DATABASE_URL?.trim()) &&
  isDatabaseConfigured();

describe.runIf(runIntegration)("scheduled email PG claim (integration)", () => {
  const orgId = `org-test-sched-${Date.now()}`;
  const mailboxId = "mb-test";
  const uid = "uid-test";

  it("claims at most one row per mailbox and is exclusive under SKIP LOCKED", async () => {
    const due = new Date(Date.now() - 60_000);
    const a = await insertScheduledEmail({
      organizationId: orgId,
      mailboxOwnerUid: uid,
      mailboxId,
      scheduledAt: due,
      toEmail: "a@example.com",
      fromEmail: "from@example.com",
      subject: "A",
      payload: { body: "a", text: "a" },
    });
    const b = await insertScheduledEmail({
      organizationId: orgId,
      mailboxOwnerUid: uid,
      mailboxId,
      scheduledAt: due,
      toEmail: "b@example.com",
      fromEmail: "from@example.com",
      subject: "B",
      payload: { body: "b", text: "b" },
    });
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });

    const [first, second] = await Promise.all([
      claimDueBatch({ limit: 10, organizationId: orgId, mailboxOwnerUid: uid, defaultGapSeconds: 0 }),
      claimDueBatch({ limit: 10, organizationId: orgId, mailboxOwnerUid: uid, defaultGapSeconds: 0 }),
    ]);
    const claimedIds = new Set([...first, ...second].map((r) => r.id));
    // One mailbox → at most one claim across both concurrent ticks in the first wave.
    expect(first.length + second.length).toBeLessThanOrEqual(1);
    expect(claimedIds.size).toBe(first.length + second.length);

    // Cleanup best-effort
    await withRlsBypass(async (tx) => {
      await tx.scheduledEmailRow.deleteMany({ where: { organizationId: orgId } });
      await tx.mailboxSendState.deleteMany({ where: { organizationId: orgId } });
    });
  });

  it("reclaims expired leases", async () => {
    const due = new Date(Date.now() - 60_000);
    const created = await insertScheduledEmail({
      organizationId: orgId,
      mailboxOwnerUid: uid,
      mailboxId: `${mailboxId}-lease`,
      scheduledAt: due,
      toEmail: "c@example.com",
      fromEmail: "from@example.com",
      subject: "C",
      payload: { body: "c", text: "c" },
    });
    expect(created).toMatchObject({ ok: true });
    if (!("ok" in created) || !created.ok) return;

    await updateScheduledEmailPg(orgId, created.id, {
      status: "processing",
      leaseId: "lease-old",
      leaseUntil: new Date(Date.now() - 60_000),
    });
    const n = await reclaimExpiredLeases();
    expect(n).toBeGreaterThanOrEqual(1);

    await withRlsBypass(async (tx) => {
      await tx.scheduledEmailRow.deleteMany({ where: { organizationId: orgId } });
    });
  });

  it("blocks suppressed recipients via isSuppressed", async () => {
    await addSuppression({
      organizationId: orgId,
      email: "blocked@example.com",
      reason: "manual",
      source: "test",
    });
    expect(await isSuppressed({ organizationId: orgId, email: "Blocked@Example.com" })).toBe(
      true,
    );
    await withRlsBypass(async (tx) => {
      await tx.emailSuppression.deleteMany({ where: { organizationId: orgId } });
    });
  });
});
