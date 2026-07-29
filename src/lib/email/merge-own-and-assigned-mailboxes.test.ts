import { describe, expect, it } from "vitest";
import { defaultEmailMailboxSettings } from "@/lib/email-account-types";
import { mergeOwnAndAssignedMailboxes } from "@/lib/email/merge-own-and-assigned-mailboxes";

describe("mergeOwnAndAssignedMailboxes", () => {
  it("keeps own mailboxes when nothing is assigned", () => {
    const own = [defaultEmailMailboxSettings({ id: "a", label: "A" })];
    expect(mergeOwnAndAssignedMailboxes(own, [])).toEqual(own);
  });

  it("prefers assigned mailbox over own copy with the same id", () => {
    const own = [
      defaultEmailMailboxSettings({
        id: "mb-1",
        label: "Broken local",
        emailAddress: "f.clark@mailtechclick.com",
        imap: { host: "imap.gmail.com", port: 993, secure: true, user: "", password: "" },
      }),
    ];
    const assigned = [
      defaultEmailMailboxSettings({
        id: "mb-1",
        label: "Assigned",
        emailAddress: "f.clark@mailtechclick.com",
        dataOwnerUid: "owner-1",
        connectionType: "google_workspace",
        imap: { host: "imap.gmail.com", port: 993, secure: true, user: "", password: "" },
      }),
    ];
    const merged = mergeOwnAndAssignedMailboxes(own, assigned);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.dataOwnerUid).toBe("owner-1");
    expect(merged[0]?.label).toBe("Assigned");
  });

  it("prefers assigned mailbox over own copy with the same email", () => {
    const own = [
      defaultEmailMailboxSettings({
        id: "local-copy",
        emailAddress: "b.cole@mailtech360.com",
        imap: { host: "imap.gmail.com", port: 993, secure: true, user: "", password: "" },
      }),
      defaultEmailMailboxSettings({
        id: "other",
        emailAddress: "me@example.com",
      }),
    ];
    const assigned = [
      defaultEmailMailboxSettings({
        id: "owner-mb",
        emailAddress: "b.cole@mailtech360.com",
        dataOwnerUid: "admin",
      }),
    ];
    const merged = mergeOwnAndAssignedMailboxes(own, assigned);
    expect(merged.map((m) => m.id).sort()).toEqual(["other", "owner-mb"]);
    expect(merged.find((m) => m.id === "owner-mb")?.dataOwnerUid).toBe("admin");
  });
});
