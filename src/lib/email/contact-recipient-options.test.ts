import { describe, expect, it } from "vitest";
import {
  buildContactRecipientOptions,
  defaultContactRecipientEmail,
} from "@/lib/email/contact-recipient-options";
import type { Contact, Lead } from "@/lib/types";

function lead(partial: Partial<Lead> = {}): Lead {
  return {
    id: "l-1",
    accountId: "a-1",
    contactId: "ct-1",
    channel: "cold_email",
    stage: "new",
    temperature: "cold",
    priority: "medium",
    ownerId: "u-1",
    contactName: "Ada",
    companyName: "Acme",
    touches: 0,
    isIdle: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function contact(partial: Partial<Contact> = {}): Contact {
  return {
    id: "ct-1",
    accountId: "a-1",
    firstName: "Ada",
    lastName: "Lovelace",
    fullName: "Ada Lovelace",
    ownerId: "u-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("contact recipient options", () => {
  it("lists company then personal and defaults to company", () => {
    const options = buildContactRecipientOptions(
      lead({ contactEmail: "ada@acme.com" }),
      contact({ email: "ada@acme.com", personalEmail: "ada@gmail.com" }),
    );
    expect(options.map((o) => o.kind)).toEqual(["company", "personal"]);
    expect(defaultContactRecipientEmail(options)).toBe("ada@acme.com");
  });

  it("defaults to personal when company is bounced", () => {
    const options = buildContactRecipientOptions(
      lead({ contactEmail: "ada@acme.com" }),
      contact({
        email: "ada@acme.com",
        personalEmail: "ada@gmail.com",
        emailVerificationStatus: "bounced",
      }),
    );
    expect(options[0]?.bounced).toBe(true);
    expect(options[1]?.label).toContain("fallback");
    expect(defaultContactRecipientEmail(options)).toBe("ada@gmail.com");
  });

  it("falls back to lead.contactEmail when contact.email is empty", () => {
    const options = buildContactRecipientOptions(
      lead({ contactEmail: "from-lead@acme.com" }),
      contact({ personalEmail: "ada@gmail.com" }),
    );
    expect(options).toEqual([
      expect.objectContaining({ kind: "company", email: "from-lead@acme.com" }),
      expect.objectContaining({ kind: "personal", email: "ada@gmail.com" }),
    ]);
  });
});
