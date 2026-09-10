import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteDocument, setDocument } from "@/lib/db/document-shim/store";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { findMailboxHostInOrgServer } from "@/lib/email/mailbox-profiles-server";

const runDb = isDatabaseConfigured();
const ORG_A = "org-mailbox-res-a";
const ORG_B = "org-mailbox-res-b";
const HOST_UID = "uid-mailbox-host";
const MB_ID = `mb-res-${Date.now()}`;

const MB_DOC_PATH_A = `${COLLECTIONS.organizations}/${ORG_A}/${ORG_SUBCOLLECTIONS.members}/${HOST_UID}/emailMailboxes/${MB_ID}`;
const MB_DOC_PATH_B = `${COLLECTIONS.organizations}/${ORG_B}/${ORG_SUBCOLLECTIONS.members}/${HOST_UID}/emailMailboxes/${MB_ID}`;

describe.runIf(runDb)("findMailboxHostInOrgServer", () => {
  beforeAll(async () => {
    // Save mailbox under ORG_A / HOST_UID
    await setDocument(
      MB_DOC_PATH_A,
      {
        id: MB_ID,
        label: "Host Mailbox",
        enabled: true,
        displayName: "Host User",
        emailAddress: "host@org-a.local",
        replyTo: "",
        signature: "",
        connectionType: "custom",
        dailySendLimit: 100,
        sendGapSeconds: 30,
        assignedUserIds: ["uid-rep-1", "uid-rep-2"],
        smtp: {
          host: "smtp.org-a.local",
          port: 587,
          secure: false,
        },
      },
      false,
    );
  });

  afterAll(async () => {
    await deleteDocument(MB_DOC_PATH_A).catch(() => undefined);
    await deleteDocument(MB_DOC_PATH_B).catch(() => undefined);
    await disconnectPrisma();
  });

  it("resolves the mailbox host and profile in the target organization", async () => {
    const result = await findMailboxHostInOrgServer({
      organizationId: ORG_A,
      mailboxId: MB_ID,
    });

    expect(result).not.toBeNull();
    expect(result?.uid).toBe(HOST_UID);
    expect(result?.mailbox.id).toBe(MB_ID);
    expect(result?.mailbox.emailAddress).toBe("host@org-a.local");
    expect(result?.mailbox.assignedUserIds).toContain("uid-rep-1");
  });

  it("enforces tenant isolation and does not resolve across organizations", async () => {
    const result = await findMailboxHostInOrgServer({
      organizationId: ORG_B,
      mailboxId: MB_ID,
    });

    expect(result).toBeNull();
  });

  it("returns null when the mailbox does not exist", async () => {
    const result = await findMailboxHostInOrgServer({
      organizationId: ORG_A,
      mailboxId: "mb-non-existent-12345",
    });

    expect(result).toBeNull();
  });
});
