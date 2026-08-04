import { describe, expect, it } from "vitest";
import {
  buildOwnerMailboxMatchGroups,
  filterMailboxesSharedWithLeadOwner,
  leadOwnerCanSendFromMailbox,
  mailboxCredentialOwnerUid,
  ownerSharedMailboxSkipReason,
} from "@/lib/email/owner-shared-mailbox";
import type { EmailMailboxSettings } from "@/lib/email-account-types";

function mb(
  partial: Partial<EmailMailboxSettings> & { id: string },
): EmailMailboxSettings {
  return {
    id: partial.id,
    label: partial.label ?? partial.id,
    enabled: true,
    displayName: "",
    emailAddress: partial.emailAddress ?? `${partial.id}@ex.com`,
    replyTo: "",
    smtp: { host: "", port: 587, secure: false, user: "", password: "" },
    imap: { host: "", port: 993, secure: true, user: "", password: "" },
    signature: "",
    syncIntervalMinutes: 5,
    archiveOnSend: false,
    readReceipts: false,
    trackClicks: false,
    connectionType: "custom",
    dailySendLimit: null,
    assignedUserIds: partial.assignedUserIds ?? [],
    dataOwnerUid: partial.dataOwnerUid,
  };
}

describe("owner-shared mailbox matching", () => {
  it("treats missing dataOwnerUid as the viewer", () => {
    expect(mailboxCredentialOwnerUid(mb({ id: "a" }), "mgr")).toBe("mgr");
    expect(mailboxCredentialOwnerUid(mb({ id: "a", dataOwnerUid: "abuzar" }), "mgr")).toBe(
      "abuzar",
    );
  });

  it("allows full pool for self-owned and open-queue leads", () => {
    const box = mb({ id: "mgr-box" });
    expect(
      leadOwnerCanSendFromMailbox({
        mailbox: box,
        leadOwnerId: "mgr",
        viewerUid: "mgr",
      }),
    ).toBe(true);
    expect(
      leadOwnerCanSendFromMailbox({
        mailbox: box,
        leadOwnerId: "",
        viewerUid: "mgr",
      }),
    ).toBe(true);
  });

  it("matches when mailbox belongs to the lead owner", () => {
    const box = mb({ id: "abuzar-box", dataOwnerUid: "abuzar" });
    expect(
      leadOwnerCanSendFromMailbox({
        mailbox: box,
        leadOwnerId: "abuzar",
        viewerUid: "mgr",
      }),
    ).toBe(true);
    expect(
      leadOwnerCanSendFromMailbox({
        mailbox: box,
        leadOwnerId: "danish",
        viewerUid: "mgr",
      }),
    ).toBe(false);
  });

  it("matches when lead owner is assigned to the mailbox", () => {
    const box = mb({ id: "mgr-box", assignedUserIds: ["abuzar", "danish"] });
    expect(
      leadOwnerCanSendFromMailbox({
        mailbox: box,
        leadOwnerId: "abuzar",
        viewerUid: "mgr",
      }),
    ).toBe(true);
    expect(
      leadOwnerCanSendFromMailbox({
        mailbox: box,
        leadOwnerId: "other",
        viewerUid: "mgr",
      }),
    ).toBe(false);
  });

  it("filters the selected pool to the owner intersection", () => {
    const pool = [
      mb({ id: "mgr-only" }),
      mb({ id: "shared", assignedUserIds: ["abuzar"] }),
      mb({ id: "abuzar-own", dataOwnerUid: "abuzar" }),
      mb({ id: "danish-own", dataOwnerUid: "danish" }),
    ];
    const shared = filterMailboxesSharedWithLeadOwner({
      mailboxes: pool,
      leadOwnerId: "abuzar",
      viewerUid: "mgr",
    });
    expect(shared.map((m) => m.id).sort()).toEqual(["abuzar-own", "shared"]);
  });

  it("builds owner match groups for preflight", () => {
    const pool = [
      mb({ id: "mgr-only" }),
      mb({ id: "shared", assignedUserIds: ["abuzar"] }),
    ];
    const groups = buildOwnerMailboxMatchGroups({
      leadOwnerIds: ["mgr", "abuzar", "abuzar", "danish", ""],
      selectedMailboxes: pool,
      viewerUid: "mgr",
    });
    expect(groups.find((g) => g.ownerId === "mgr")?.sharedMailboxIds).toHaveLength(2);
    expect(groups.find((g) => g.ownerId === "")?.isSelfOrOpen).toBe(true);
    expect(groups.find((g) => g.ownerId === "abuzar")?.sharedMailboxIds).toEqual(["shared"]);
    expect(groups.find((g) => g.ownerId === "danish")?.sharedMailboxIds).toEqual([]);
    expect(groups.find((g) => g.ownerId === "abuzar")?.leadCount).toBe(2);
  });

  it("formats skip reason with owner name", () => {
    expect(ownerSharedMailboxSkipReason("Abuzar")).toBe("No shared inbox with Abuzar");
  });
});
