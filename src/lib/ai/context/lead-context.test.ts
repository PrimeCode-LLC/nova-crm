import { describe, expect, it } from "vitest";
import { buildLeadAiContext } from "@/lib/ai/context/lead-context";
import type { Lead } from "@/lib/types";

const lead = {
  id: "lead-1",
  accountId: "account-1",
  contactId: "contact-1",
  channel: "personalized_email",
  stage: "qualified",
  temperature: "warm",
  priority: "high",
  ownerId: "owner-1",
  contactName: "Ada Lovelace",
  companyName: "Analytical Engines",
  touches: 2,
  isIdle: false,
  doNotContact: false,
  qualityScore: 88,
  primaryOpportunityLabel: "Workflow modernization",
  intentEvidence: [
    {
      id: "evidence-1",
      label: "Hiring platform engineers",
      category: "hiring",
      strength: "strong",
      sourceUrl: "https://example.com/careers",
      observedAt: "2026-07-20",
      explanation: "Three new platform roles were published.",
    },
  ],
  personalizationNote: {
    trigger: "Platform hiring",
    likelyImpact: "More delivery coordination",
    relevantService: "Workflow automation",
    suggestedAngle: "Reduce coordination overhead while the team scales",
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as Lead;

describe("buildLeadAiContext", () => {
  it("includes structured prospect intelligence, history, and attribution", () => {
    const context = JSON.parse(
      buildLeadAiContext({
        lead,
        notes: [],
        timeline: [],
        touchpoints: [],
        followups: [
          {
            id: "followup-1",
            leadId: lead.id,
            title: "Existing opener",
            messageBody: "Full existing message copy",
            dueAt: "2026-07-22T00:00:00.000Z",
            ownerId: "owner-1",
            priority: "high",
            auto: false,
          },
        ],
        tasks: [],
        emailThreads: [
          {
            subject: "Re: workflow",
            messages: [
              {
                from: "ada@example.com",
                date: "2026-07-20T00:00:00.000Z",
                snippet: "We are evaluating this next quarter.",
              },
            ],
          },
        ],
        strategy: {
          id: "strategy-1",
          organizationId: "org-1",
          name: "Platform teams",
          ownerId: "owner-1",
          status: "published",
          priority: 1,
          personaIds: [],
          firmographics: {
            targetIndustries: [],
            excludedIndustries: [],
            targetCountries: [],
            excludedCountries: [],
            targetRegions: [],
            requiredKeywords: [],
            excludedKeywords: [],
          },
          linkedSignals: [],
          qualityChecklist: [],
          dailyTargetDefault: 10,
          version: 2,
          createdBy: "owner-1",
          updatedBy: "owner-1",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      }),
    );

    expect(context.lead.qualityScore).toBe(88);
    expect(context.lead.intentEvidence[0].sourceUrl).toBe("https://example.com/careers");
    expect(context.lead.personalizationNote.suggestedAngle).toContain("coordination");
    expect(context.followups[0].messageBody).toBe("Full existing message copy");
    expect(context.emailThreads[0].messages[0].snippet).toContain("next quarter");
    expect(context.prospectingStrategy.name).toBe("Platform teams");
  });

  it("keeps valid JSON when an individual field is very long", () => {
    const context = buildLeadAiContext({
      lead: { ...lead, notes: "x".repeat(10_000) },
      notes: [],
      timeline: [],
      touchpoints: [],
      followups: [],
      tasks: [],
    });

    expect(() => JSON.parse(context)).not.toThrow();
    expect(JSON.parse(context).lead.notes).toContain("[field truncated]");
  });
});
