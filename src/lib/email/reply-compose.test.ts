import { describe, expect, it } from "vitest";
import { defaultEmailMailboxSettings } from "@/lib/email-account-types";
import {
  applyMailboxHandoffCc,
  appendRecipientAddress,
  mailboxPrimaryAddress,
  rebuildComposeBodyWithMailboxSignature,
  withoutMailboxIdentities,
} from "@/lib/email/reply-compose";

const sales = defaultEmailMailboxSettings({
  id: "mb-sales",
  label: "Sales",
  emailAddress: "sales@company.com",
  signature: "Best,\nSales Team",
});

const founder = defaultEmailMailboxSettings({
  id: "mb-founder",
  label: "Founder",
  emailAddress: "founder@company.com",
  signature: "Thanks,\nFounder",
});

describe("mailbox handoff helpers", () => {
  it("appends recipient without duplicates", () => {
    expect(appendRecipientAddress("a@x.com", "b@y.com")).toBe("a@x.com, b@y.com");
    expect(appendRecipientAddress("a@x.com, b@y.com", "A@x.com")).toBe("a@x.com, b@y.com");
  });

  it("strips mailbox identities from cc", () => {
    expect(withoutMailboxIdentities("sales@company.com, partner@x.com", sales)).toBe("partner@x.com");
  });

  it("adds previous mailbox to Cc when From changes", () => {
    const result = applyMailboxHandoffCc({
      to: "customer@x.com",
      cc: "ops@company.com",
      previousMailbox: sales,
      nextMailbox: founder,
    });
    expect(result.added).toBe("sales@company.com");
    expect(result.cc).toContain("sales@company.com");
    expect(result.cc).toContain("ops@company.com");
    expect(result.cc).not.toContain("founder@company.com");
  });

  it("does not duplicate previous mailbox already on To", () => {
    const result = applyMailboxHandoffCc({
      to: "sales@company.com",
      cc: "",
      previousMailbox: sales,
      nextMailbox: founder,
    });
    expect(result.added).toBeNull();
    expect(result.cc).toBe("");
  });

  it("rebuilds compose body with the next signature", () => {
    const body = `\n\nBest,\nSales Team\n\n---\nOn 2026-08-01, Customer wrote:\nHello`;
    const next = rebuildComposeBodyWithMailboxSignature(body, founder.signature);
    expect(next).toContain("Thanks,\nFounder");
    expect(next).not.toContain("Sales Team");
    expect(next).toContain("---\nOn 2026-08-01");
  });

  it("reads primary mailbox address", () => {
    expect(mailboxPrimaryAddress(sales)).toBe("sales@company.com");
  });
});
