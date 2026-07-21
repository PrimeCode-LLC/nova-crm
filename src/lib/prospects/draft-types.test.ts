import { describe, expect, it } from "vitest";
import {
  draftCompletion,
  normalizeProspectDraftFieldValue,
  type ProspectDraftField,
} from "./draft-types";

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
