import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteDocument, queryDocuments, setDocument } from "@/lib/db/document-shim/store";
import { coerceIsoInstant } from "@/lib/db/document-shim/timestamp";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";

const runDb = isDatabaseConfigured();
const ORG = "org-vitest-scheduled";
const UID = "uid-vitest-scheduled";
const DOC_ID = `sch-vitest-${Date.now()}`;
const DOC_PATH = `${COLLECTIONS.organizations}/${ORG}/${ORG_SUBCOLLECTIONS.members}/${UID}/scheduledEmails/${DOC_ID}`;

vi.mock("@/lib/email/send-outbound-mail-server", () => ({
  sendOutboundMailServer: vi.fn(async () => ({ ok: true, messageId: "<vitest-local@nova>" })),
}));

vi.mock("@/lib/email/mailbox-profiles-server", () => ({
  listMailboxesForMemberServer: vi.fn(async () => [
    {
      id: "mb-vitest",
      enabled: true,
      emailAddress: "vitest@nova.local",
      displayName: "Vitest",
      replyTo: "",
      signature: "",
      smtp: {
        host: "smtp.test",
        port: 587,
        secure: false,
        user: "u",
        password: "p",
      },
      imap: {
        host: "imap.test",
        port: 993,
        secure: true,
        user: "u",
        password: "p",
      },
      connectionType: "custom",
      dailySendLimit: null,
      sendGapSeconds: 0,
      assignedUserIds: [],
      readReceipts: false,
      trackClicks: false,
      syncIntervalMinutes: 5,
      archiveOnSend: false,
      label: "Vitest",
    },
  ]),
}));

vi.mock("@/lib/email/mailbox-send-quota-server", () => ({
  assertMailboxDailySendQuotaServer: vi.fn(async () => ({ ok: true as const })),
  getMailboxLastSentAtServer: vi.fn(async () => null),
  incrementMailboxSendCountServer: vi.fn(async () => undefined),
}));

vi.mock("@/lib/email/lead-contact-policy-server", () => ({
  assertLeadContactAllowedServer: vi.fn(async () => ({ ok: true as const })),
}));

describe.runIf(runDb)("scheduled email due send (local Postgres + mock SMTP)", () => {
  beforeAll(async () => {
    const past = new Date(Date.now() - 120_000).toISOString();
    await setDocument(
      DOC_PATH,
      {
        organizationId: ORG,
        uid: UID,
        mailboxId: "mb-vitest",
        from: "vitest@nova.local",
        to: "process-due@test.local",
        subject: "Process due test",
        text: "body",
        html: "<p>body</p>",
        scheduledAt: past,
        status: "pending",
        createdAt: past,
        updatedAt: past,
      },
      false,
    );
  });

  afterAll(async () => {
    await deleteDocument(DOC_PATH).catch(() => undefined);
    await disconnectPrisma();
  });

  it("finds overdue pending rows via collectionGroup scheduledAt <= now", async () => {
    const nowIso = new Date().toISOString();
    const docs = await queryDocuments({
      collectionGroup: "scheduledEmails",
      filters: [
        { field: "status", op: "in", value: ["pending", "processing"] },
        { field: "scheduledAt", op: "<=", value: nowIso },
      ],
      orderBy: { field: "scheduledAt", direction: "asc" },
      limit: 50,
    });

    expect(docs.some((d) => d.path === DOC_PATH)).toBe(true);
    const row = docs.find((d) => d.path === DOC_PATH);
    expect(row?.payload.status).toBe("pending");
    expect(coerceIsoInstant(row?.payload.scheduledAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it(
    "processDueScheduledEmailsForMemberServer marks due row sent",
    async () => {
    const { processDueScheduledEmailsForMemberServer } = await import(
      "@/lib/email/scheduled-emails-server"
    );
    const { sendOutboundMailServer } = await import("@/lib/email/send-outbound-mail-server");

    const result = await processDueScheduledEmailsForMemberServer({
      organizationId: ORG,
      uid: UID,
    });

    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(result.dueFound).toBeGreaterThanOrEqual(1);
    expect(result.pendingCount).toBeGreaterThanOrEqual(1);
    expect(result.skipReasons).toBeDefined();
    expect(Array.isArray(result.rows)).toBe(true);
    expect(sendOutboundMailServer).toHaveBeenCalled();

    const docs = await queryDocuments({
      collectionRoot: COLLECTIONS.organizations,
      pathPrefix: `${COLLECTIONS.organizations}/${ORG}/${ORG_SUBCOLLECTIONS.members}/${UID}/scheduledEmails`,
      filters: [{ field: "status", op: "==", value: "sent" }],
    });
    expect(docs.some((d) => d.path === DOC_PATH)).toBe(true);
  },
    30_000,
  );
});
