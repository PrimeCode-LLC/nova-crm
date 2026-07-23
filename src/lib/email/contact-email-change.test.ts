import { describe, expect, it } from "vitest";
import {
  applyContactEmailUpdate,
  buildEmailChangeTimelineEvents,
  contactPatchClearingBounce,
  diffContactEmailChanges,
  emailChangeTimelineSummary,
} from "@/lib/email/contact-email-change";
import { extractSuggestedNewEmail } from "@/lib/email/extract-suggested-new-email";
import type { Contact, Lead } from "@/lib/types";

function contact(partial: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    accountId: "a1",
    firstName: "Filip",
    lastName: "Kaliszan",
    fullName: "Filip Kaliszan",
    email: "filip.kaliszan@verkada.com",
    personalEmail: "filip.kaliszan@gmail.com",
    ownerId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("extractSuggestedNewEmail", () => {
  it("extracts address after 'new email is'", () => {
    expect(
      extractSuggestedNewEmail(
        "Hi - my new email is filip@newco.com. Please use that going forward.",
        ["filip.kaliszan@verkada.com"],
      ),
    ).toBe("filip@newco.com");
  });

  it("extracts after 'please contact me at'", () => {
    expect(
      extractSuggestedNewEmail("Please contact me at ceo@verkada.io instead.", ["old@verkada.com"]),
    ).toBe("ceo@verkada.io");
  });

  it("ignores known emails", () => {
    expect(
      extractSuggestedNewEmail("My new email is filip.kaliszan@verkada.com", [
        "filip.kaliszan@verkada.com",
      ]),
    ).toBeNull();
  });

  it("returns null without change language", () => {
    expect(extractSuggestedNewEmail("Thanks, see you Thursday. cc teammate@x.com")).toBeNull();
  });
});

describe("contact email change helpers", () => {
  it("diffs company email changes", () => {
    const changes = diffContactEmailChanges(contact(), { email: "new@verkada.com" });
    expect(changes).toEqual([
      {
        field: "email",
        label: "Company email",
        from: "filip.kaliszan@verkada.com",
        to: "new@verkada.com",
      },
    ]);
    expect(emailChangeTimelineSummary(changes[0]!)).toContain("→");
  });

  it("clears bounce when company email is replaced", () => {
    const bounced = contact({
      emailVerificationStatus: "bounced",
      emailBouncedAt: "2026-07-01T00:00:00.000Z",
      emailVerified: false,
    });
    const patch = contactPatchClearingBounce(bounced, { email: "fixed@verkada.com" });
    expect(patch.emailVerificationStatus).toBe("not_verified");
    expect(patch.emailBouncedAt).toBeUndefined();
    expect(patch.emailVerified).toBe(false);
  });

  it("builds timeline events for email changes", () => {
    const events = buildEmailChangeTimelineEvents({
      leadId: "l1",
      actorId: "u1",
      changes: diffContactEmailChanges(contact(), { email: "x@y.com" }),
      now: "2026-07-23T00:00:00.000Z",
      newId: () => "te-1",
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("field_changed");
    expect(events[0]!.summary).toMatch(/Company email changed from .+ → x@y\.com/);
  });

  it("applyContactEmailUpdate syncs lead snapshot", () => {
    const lead = {
      id: "l1",
      contactId: "c1",
      accountId: "a1",
      contactEmail: "filip.kaliszan@verkada.com",
      emailVerified: false,
    } as Lead;
    const bounced = contact({ emailVerificationStatus: "bounced", emailVerified: false });
    const result = applyContactEmailUpdate({
      contact: bounced,
      lead,
      field: "email",
      nextEmail: "fixed@verkada.com",
    });
    expect(result.leadPatch.contactEmail).toBe("fixed@verkada.com");
    expect(result.changes).toHaveLength(1);
  });
});
