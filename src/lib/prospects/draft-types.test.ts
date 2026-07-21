import { describe, expect, it } from "vitest";
import {
  applyReviewedDraftValues,
  draftCompletion,
  draftCompletionForForm,
  normalizeProspectDraftFieldValue,
  type ProspectDraftField,
} from "./draft-types";
import { emptyProspectForm } from "./prospect-form";

function field(
  value: string,
  status: ProspectDraftField["status"] = "verified",
): ProspectDraftField {
  return {
    value,
    confidence: 1,
    status,
    evidence: [],
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

describe("draftCompletion", () => {
  it("requires company and contact names", () => {
    expect(draftCompletion({}).missingRequiredFields).toEqual([
      "companyName",
      "contactName",
    ]);
  });

  it("does not count conflicting values as complete", () => {
    const result = draftCompletion({
      companyName: field("Nova"),
      contactName: field("Ada Lovelace", "conflict"),
    });
    expect(result.missingRequiredFields).toEqual(["contactName"]);
  });

  it("reports full completion for all useful fields", () => {
    const result = draftCompletion({
      companyName: field("Nova"),
      contactName: field("Ada Lovelace"),
      companyDomain: field("nova.example"),
      companyWebsite: field("https://nova.example"),
      industry: field("Software"),
      contactTitle: field("CTO"),
      contactEmail: field("ada@nova.example"),
      contactLinkedIn: field("https://linkedin.com/in/ada"),
      triggerEvent: field("Opened a new office"),
      painPoints: field("Hiring capacity"),
    });
    expect(result).toEqual({ missingRequiredFields: [], completionPercent: 100 });
  });

  it("recognizes required values stored in a manual full form", () => {
    const form = emptyProspectForm();
    form.bizName = "Nova";
    form.firstName = "Ada";
    form.lastName = "Lovelace";

    expect(draftCompletionForForm({}, form).missingRequiredFields).toEqual([]);
    form.lastName = "";
    expect(draftCompletionForForm({}, form).missingRequiredFields).toContain("contactName");
  });
});

describe("normalizeProspectDraftFieldValue", () => {
  it("normalizes identity and URL fields conservatively", () => {
    expect(
      normalizeProspectDraftFieldValue("companyDomain", " HTTPS://WWW.Example.com/about "),
    ).toBe("example.com");
    expect(
      normalizeProspectDraftFieldValue("companyWebsite", "www.example.com/"),
    ).toBe("https://www.example.com");
    expect(normalizeProspectDraftFieldValue("contactEmail", " ADA@Example.COM ")).toBe(
      "ada@example.com",
    );
    expect(normalizeProspectDraftFieldValue("yearFounded", "Founded in 2021")).toBe("2021");
  });
});

describe("applyReviewedDraftValues", () => {
  it("verifies edited fields without changing untouched AI proposals or evidence", () => {
    const company = field("Nova", "proposed");
    company.evidence = [{ sourceId: "s-1", sourceUrl: "https://nova.example", quote: "Nova" }];
    const title = field("CTO", "conflict");
    title.alternatives = [{ value: "CIO", confidence: 0.8, evidence: [] }];
    const result = applyReviewedDraftValues(
      { companyName: company, contactTitle: title },
      { companyName: "Nova Labs" },
      "2026-07-21T01:00:00.000Z",
    );
    expect(result.companyName).toMatchObject({
      value: "Nova Labs",
      status: "verified",
      evidence: company.evidence,
    });
    expect(result.contactTitle).toEqual(title);
  });
});
