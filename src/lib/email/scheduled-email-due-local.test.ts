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
  listMailboxesForMemberServer: vi.fn(async ({ uid }) => {
    if (uid === "uid-rep-assigned") {
      return [];
    }
    return [
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
    ];
  }),
  findMailboxHostInOrgServer: vi.fn(async ({ mailboxId }) => {
    if (mailboxId === "mb-assigned-host") {
      return {
        uid: "uid-host-owner",
        mailbox: {
          id: "mb-assigned-host",
          enabled: true,
          emailAddress: "host@nova.local",
          displayName: "Host",
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
          assignedUserIds: ["uid-rep-assigned"],
          readReceipts: false,
          trackClicks: false,
          syncIntervalMinutes: 5,
          archiveOnSend: false,
          label: "Host Mailbox",
        },
      };
    }
    return null;
  }),
}));

vi.mock("@/lib/email/mailbox-send-quota-server", () => ({
  assertMailboxDailySendQuotaServer: vi.fn(async () => ({ ok: true as const })),
  reserveMailboxDailySendServer: vi.fn(async () => ({
    ok: true as const,
    used: 1,
    limit: null,
    remaining: null,
  })),
  releaseMailboxDailySendServer: vi.fn(async () => undefined),
  releaseMailboxScheduleSlotServer: vi.fn(async () => undefined),
  getMailboxLastSentAtServer: vi.fn(async () => null),
  incrementMailboxSendCountServer: vi.fn(async () => undefined),
}));

vi.mock("@/lib/email/lead-contact-policy-server", () => ({
  assertLeadContactAllowedServer: vi.fn(async () => ({ ok: true as const })),
}));

const UID_2 = "uid-vitest-scheduled-2";
const DOC_ID_2 = `sch-vitest-2-${Date.now()}`;
const DOC_PATH_2 = `${COLLECTIONS.organizations}/${ORG}/${ORG_SUBCOLLECTIONS.members}/${UID_2}/scheduledEmails/${DOC_ID_2}`;

const UID_REP = "uid-rep-assigned";
const DOC_ID_REP = `sch-vitest-rep-${Date.now()}`;
const DOC_PATH_REP = `${COLLECTIONS.organizations}/${ORG}/${ORG_SUBCOLLECTIONS.members}/${UID_REP}/scheduledEmails/${DOC_ID_REP}`;

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
    await deleteDocument(DOC_PATH_2).catch(() => undefined);
    await deleteDocument(DOC_PATH_REP).catch(() => undefined);
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

  it(
    "processDueScheduledEmailsForOrgServer processes due mail across different member roots",
    async () => {
      const past = new Date(Date.now() - 120_000).toISOString();
      await setDocument(
        DOC_PATH_2,
        {
          organizationId: ORG,
          uid: UID_2,
          mailboxId: "mb-vitest",
          from: "vitest@nova.local",
          to: "member2-due@test.local",
          subject: "Org process due test",
          text: "body 2",
          html: "<p>body 2</p>",
          scheduledAt: past,
          status: "pending",
          createdAt: past,
          updatedAt: past,
        },
        false,
      );

      const { processDueScheduledEmailsForOrgServer } = await import(
        "@/lib/email/scheduled-emails-server"
      );

      const result = await processDueScheduledEmailsForOrgServer({
        organizationId: ORG,
      });

      expect(result.sent).toBeGreaterThanOrEqual(1);
      expect(result.dueFound).toBeGreaterThanOrEqual(1);

      const docs = await queryDocuments({
        collectionRoot: COLLECTIONS.organizations,
        pathPrefix: `${COLLECTIONS.organizations}/${ORG}/${ORG_SUBCOLLECTIONS.members}/${UID_2}/scheduledEmails`,
        filters: [{ field: "status", op: "==", value: "sent" }],
      });
      expect(docs.some((d) => d.path === DOC_PATH_2)).toBe(true);
    },
    30_000,
  );

  it(
    "resolves mailbox host when scheduled doc belongs to an assigned rep and passes host UID to sender",
    async () => {
      const past = new Date(Date.now() - 120_000).toISOString();
      await setDocument(
        DOC_PATH_REP,
        {
          organizationId: ORG,
          uid: UID_REP,
          mailboxId: "mb-assigned-host",
          from: "host@nova.local",
          to: "lead-assigned@test.local",
          subject: "Assigned mailbox send test",
          text: "rep body",
          html: "<p>rep body</p>",
          scheduledAt: past,
          status: "pending",
          createdAt: past,
          updatedAt: past,
        },
        false,
      );

      const { processDueScheduledEmailsForMemberServer } = await import(
        "@/lib/email/scheduled-emails-server"
      );
      const { sendOutboundMailServer } = await import("@/lib/email/send-outbound-mail-server");

      const result = await processDueScheduledEmailsForMemberServer({
        organizationId: ORG,
        uid: UID_REP,
      });

      expect(result.sent).toBeGreaterThanOrEqual(1);

      // Verify sendOutboundMailServer was called with uid: "uid-host-owner" (the mailbox host), NOT "uid-rep-assigned"
      expect(sendOutboundMailServer).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          uid: "uid-host-owner",
          mailboxId: "mb-assigned-host",
        }),
      );

      const docs = await queryDocuments({
        collectionRoot: COLLECTIONS.organizations,
        pathPrefix: `${COLLECTIONS.organizations}/${ORG}/${ORG_SUBCOLLECTIONS.members}/${UID_REP}/scheduledEmails`,
        filters: [{ field: "status", op: "==", value: "sent" }],
      });
      expect(docs.some((d) => d.path === DOC_PATH_REP)).toBe(true);
    },
    30_000,
  );
});
