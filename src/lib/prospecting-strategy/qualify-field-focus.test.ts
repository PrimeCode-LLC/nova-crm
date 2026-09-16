import { describe, expect, it } from "vitest";
import type { QualifyIssue } from "@/lib/prospecting-strategy/qualify";
import {
  firstQualifyFieldCode,
  issuesToFieldErrors,
  prospectFieldAnchorId,
} from "@/lib/prospecting-strategy/qualify-field-focus";

describe("qualify-field-focus", () => {
  it("maps blocking issues to field errors", () => {
    const issues: QualifyIssue[] = [
      { code: "company_website", message: "Company website is required", blocking: true },
      { code: "second_contact", message: "soft", blocking: false },
      { code: "contact_title", message: "Job title is required", blocking: true },
    ];
    expect(issuesToFieldErrors(issues)).toEqual({
      company_website: "Company website is required",
      contact_title: "Job title is required",
    });
  });

  it("picks the first blocking field in form order", () => {
    const issues: QualifyIssue[] = [
      { code: "opportunity", message: "opp", blocking: true },
      { code: "company_website", message: "web", blocking: true },
      { code: "intent_evidence", message: "ev", blocking: true },
    ];
    expect(firstQualifyFieldCode(issues)).toBe("company_website");
  });

  it("builds stable anchor ids", () => {
    expect(prospectFieldAnchorId("verified_email")).toBe("prospect-field-verified_email");
  });
});
