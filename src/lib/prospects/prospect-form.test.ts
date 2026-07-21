import { describe, expect, it } from "vitest";

import { prospectFormFromDraft, type ProspectDraft } from "./draft-types";
import {
  buildProspectEntities,
  emptyProspectForm,
  evaluateOutreachReadiness,
  parseProspectForm,
  validateProspectForm,
} from "./prospect-form";

function legacyDraft(): ProspectDraft {
  const field = (value: string) => ({
    value,
    confidence: 0.9,
    status: "proposed" as const,
    evidence: [],
    updatedAt: "2026-07-21T00:00:00.000Z",
  });
  return {
    id: "pd-1",
    organizationId: "org-1",
    userId: "u-1",
    revision: 0,
    status: "active",
    origin: "intent_radar",
    fields: {
      companyName: field("Nova"),
      companyWebsite: field("https://nova.example"),
      contactName: field("Ada Lovelace"),
      contactEmail: field("ADA@Nova.example"),
      triggerEvent: field("Expansion"),
    },
    sources: [],
    sourceCount: 0,
    strategy: {
      strategyId: "strategy-1",
      strategyName: "Expansion",
      strategyVersion: 3,
      strategyAssignmentId: "assignment-1",
      score: 90,
      selectionMode: "auto",
    },
    missingRequiredFields: [],
    completionPercent: 50,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    lastSavedAt: "2026-07-21T00:00:00.000Z",
  };
}

describe("prospect form hydration", () => {
  it("hydrates legacy AI fields and strategy attribution", () => {
    const form = prospectFormFromDraft(legacyDraft());
    expect(form.bizName).toBe("Nova");
    expect(form.firstName).toBe("Ada");
    expect(form.lastName).toBe("Lovelace");
    expect(form.email).toBe("ADA@Nova.example");
    expect(form.strategyId).toBe("strategy-1");
    expect(form.strategyVersion).toBe(3);
  });

  it("round-trips the full typed form schema", () => {
    const form = emptyProspectForm();
    form.bizName = "Nova";
    form.firstName = "Ada";
    form.lastName = "Lovelace";
    form.channel = "linkedin_outbound";
    form.priority = "urgent";
    expect(parseProspectForm(JSON.parse(JSON.stringify(form)))).toEqual(form);
  });
});

describe("prospect form validation and mapping", () => {
  it("reports channel-specific outreach issues", () => {
    const form = emptyProspectForm();
    form.channel = "linkedin_outbound";
    expect(evaluateOutreachReadiness(form)).toContain("Add a LinkedIn profile");
    form.doNotContact = true;
    expect(evaluateOutreachReadiness(form)).toEqual([
      "Outreach is blocked by do-not-contact",
    ]);
  });

  it("maps every selected intake value without hardcoded defaults", () => {
    const form = emptyProspectForm();
    Object.assign(form, {
      bizName: "Nova",
      firstName: "Ada",
      lastName: "Lovelace",
      website: "https://nova.example",
      email: "ADA@Nova.example",
      channel: "linkedin_outbound",
      stage: "qualified",
      temperature: "hot",
      priority: "urgent",
      nextAction: "Send note",
      doNotContact: true,
      emailVerify: "verified",
      strategyId: "strategy-1",
      strategyAssignmentId: "assignment-1",
      strategyVersion: 4,
      personaId: "persona-1",
    });
    form.qualifyForm.qualifyStatus = "incomplete";
    const { account, contact, lead } = buildProspectEntities({
      form,
      accountId: "a-1",
      contactId: "ct-1",
      leadId: "l-1",
      ownerId: "u-1",
      now: "2026-07-21T00:00:00.000Z",
      research: { businessFocus: "Automation", companyDomain: "fallback.example" },
    });
    expect(account.domain).toBe("nova.example");
    expect(contact.email).toBe("ada@nova.example");
    expect(lead).toMatchObject({
      channel: "linkedin_outbound",
      stage: "qualified",
      temperature: "hot",
      priority: "urgent",
      nextAction: "Send note",
      doNotContact: true,
      emailVerified: true,
      strategyId: "strategy-1",
      personaId: "persona-1",
      businessFocus: "Automation",
      prospectQualifyStatus: "incomplete",
    });
  });

  it("keeps qualification blockers separate from basic form errors", () => {
    const form = emptyProspectForm();
    const result = validateProspectForm(form, {
      existingContactsForCompany: 0,
      maxContactsPerCompany: 2,
      outreachThreshold: 45,
    });
    expect(result.errors).toContain("Business name is required.");
    expect(result.qualifyIssues.some((issue) => issue.blocking)).toBe(true);
  });
});
