import { describe, expect, it } from "vitest";
import {
  applyLeadContactSwitch,
  leadContactSnapshotFromContact,
  resumeEmailForContact,
  siblingContactsOnAccount,
} from "@/lib/leads/switch-lead-contact";
import type { Contact, Lead } from "@/lib/types";

function contact(partial: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    accountId: "a1",
    firstName: "Filip",
    lastName: "Kaliszan",
    fullName: "Filip Kaliszan",
    email: "filip@verkada.com",
    ownerId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function lead(partial: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    accountId: "a1",
    contactId: "c1",
    ownerId: "u1",
    channel: "cold_email",
    stage: "new",
    contactName: "Filip Kaliszan",
    contactEmail: "filip@verkada.com",
    companyName: "Verkada",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Lead;
}

describe("switch lead contact", () => {
  it("builds snapshot from contact and clears inherited bounce denorm", () => {
    const snap = leadContactSnapshotFromContact(
      contact({
        id: "c2",
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        email: "ada@verkada.com",
        title: "CTO",
        linkedin: "https://linkedin.com/in/ada",
        emailVerificationStatus: "not_verified",
      }),
    );
    expect(snap.contactName).toBe("Ada Lovelace");
    expect(snap.contactTitle).toBe("CTO");
    expect(snap.contactEmail).toBe("ada@verkada.com");
    expect(snap.contactLinkedIn).toBe("https://linkedin.com/in/ada");
    expect(snap.emailVerificationSource).toBeUndefined();
  });

  it("switches contact, resets bounce exhaustion, keeps same account", () => {
    const from = contact({
      emailVerificationStatus: "bounced",
      emailVerificationSource: "bounce",
    });
    const to = contact({
      id: "c2",
      firstName: "Ada",
      lastName: "Lovelace",
      fullName: "Ada Lovelace",
      email: "ada@verkada.com",
      title: "VP Ops",
    });
    const result = applyLeadContactSwitch({
      lead: lead({
        emailHardBounceCount: 2,
        suggestLinkedInSequence: true,
        personaId: "persona-old",
      }),
      fromContact: from,
      toContact: to,
      personaId: "persona-ops",
    });

    expect(result.leadPatch.contactId).toBe("c2");
    expect(result.leadPatch.contactName).toBe("Ada Lovelace");
    expect(result.leadPatch.contactEmail).toBe("ada@verkada.com");
    expect(result.leadPatch.emailHardBounceCount).toBe(0);
    expect(result.leadPatch.suggestLinkedInSequence).toBe(false);
    expect(result.leadPatch.personaId).toBe("persona-ops");
    expect(result.resumeToEmail).toBe("ada@verkada.com");
    expect(result.timelineSummary).toContain("Filip Kaliszan");
    expect(result.timelineSummary).toContain("Ada Lovelace");
  });

  it("rejects switching to a contact on another account", () => {
    expect(() =>
      applyLeadContactSwitch({
        lead: lead(),
        fromContact: contact(),
        toContact: contact({ id: "c2", accountId: "other" }),
      }),
    ).toThrow(/same company/);
  });

  it("returns null resume email when new contact has no usable address", () => {
    const to = contact({
      id: "c2",
      email: undefined,
      personalEmail: undefined,
      fullName: "No Email",
    });
    expect(resumeEmailForContact({ contactEmail: undefined }, to)).toBeNull();
  });

  it("lists sibling contacts on the account", () => {
    const siblings = siblingContactsOnAccount(
      [
        contact({ id: "c1" }),
        contact({ id: "c2", fullName: "Ada Lovelace" }),
        contact({ id: "c3", accountId: "other", fullName: "Other Co" }),
      ],
      "a1",
      "c1",
    );
    expect(siblings.map((c) => c.id)).toEqual(["c2"]);
  });
});
