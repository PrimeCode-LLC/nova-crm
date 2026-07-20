import { describe, expect, it } from "vitest";
import {
  evidencePassesStrengthRule,
  evaluateQualifyGate,
  personalizationIsComplete,
  type IntentEvidence,
} from "@/lib/prospecting-strategy/qualify";

function evidence(partial: Partial<IntentEvidence> & Pick<IntentEvidence, "id" | "strength" | "category">): IntentEvidence {
  return {
    label: "Test signal",
    sourceUrl: "https://example.com/news",
    observedAt: new Date().toISOString().slice(0, 10),
    explanation: "Clear explanation of why this matters for Stellix Soft.",
    ...partial,
  };
}

describe("qualify gate", () => {
  it("passes with one strong signal and full personalization", () => {
    const gate = evaluateQualifyGate({
      companyName: "Acme Logistics",
      companyWebsite: "https://acme.example",
      contactName: "Jane Doe",
      contactTitle: "VP Supply Chain",
      contactLinkedIn: "https://linkedin.com/in/jane",
      emailVerified: true,
      intentEvidence: [evidence({ id: "1", strength: "strong", category: "Facility expansion" })],
      personalizationNote: {
        trigger: "New DC",
        likelyImpact: "Need visibility",
        relevantService: "RFID",
        suggestedAngle: "Ask about tech layer",
      },
      primaryOpportunityLabel: "RFID and WMS integrations",
    });
    expect(gate.ok).toBe(true);
  });

  it("requires two medium signals from different categories", () => {
    expect(
      evidencePassesStrengthRule([
        evidence({ id: "1", strength: "medium", category: "Hiring" }),
        evidence({ id: "2", strength: "medium", category: "Hiring" }),
      ]),
    ).toBe(false);
    expect(
      evidencePassesStrengthRule([
        evidence({ id: "1", strength: "medium", category: "Hiring" }),
        evidence({ id: "2", strength: "medium", category: "Automation" }),
      ]),
    ).toBe(true);
  });

  it("blocks incomplete personalization", () => {
    expect(
      personalizationIsComplete({
        trigger: "x",
        likelyImpact: "",
        relevantService: "y",
        suggestedAngle: "z",
      }),
    ).toBe(false);
  });

  it("blocks max contacts per company", () => {
    const gate = evaluateQualifyGate({
      companyName: "Acme",
      companyWebsite: "https://acme.example",
      contactName: "A B",
      contactTitle: "VP Logistics",
      contactLinkedIn: "https://linkedin.com/in/a",
      emailVerified: true,
      intentEvidence: [evidence({ id: "1", strength: "strong", category: "Facility expansion" })],
      personalizationNote: {
        trigger: "t",
        likelyImpact: "i",
        relevantService: "s",
        suggestedAngle: "a",
      },
      primaryOpportunityLabel: "Dispatch",
      existingContactsForCompany: 2,
      maxContactsPerCompany: 2,
    });
    expect(gate.ok).toBe(false);
    expect(gate.issues.some((i) => i.code === "max_contacts")).toBe(true);
  });
});
