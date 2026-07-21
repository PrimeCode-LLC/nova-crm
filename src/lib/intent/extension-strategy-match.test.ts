import { describe, expect, it } from "vitest";
import {
  computeQualityScoreCore,
  findKeywordEvidence,
  rankAssignedStrategies,
  type IntentPlaybook,
} from "@nova/scoring";

const playbook: IntentPlaybook = {
  templateId: "test",
  name: "Test",
  outreachThreshold: 30,
  tempBands: { warmMin: 30, hotMin: 70 },
  autoTemperature: true,
  engagement: { reply: 0, multiTouch: 0, multiTouchMin: 3 },
  signals: [
    {
      id: "integration",
      label: "Integration demand",
      category: "digital_transformation",
      points: 40,
      enabled: true,
      keywords: ["manual system integration"],
      qualificationRole: "demand",
    },
    {
      id: "hiring",
      label: "Hiring",
      category: "hiring",
      points: 10,
      enabled: true,
      keywords: ["hiring software engineers"],
      qualificationRole: "supporting",
    },
  ],
  opportunityRoutes: [
    { id: "automation", label: "Integrations and Automation", signalIds: ["integration"] },
  ],
};

describe("extension evidence and assigned strategy ranking", () => {
  it("returns conceptual surface evidence with ranges", () => {
    const evidence = findKeywordEvidence(
      [{ id: "b0", text: "The team manually connects disconnected systems every week." }],
      "manual system integration",
    );
    expect(evidence?.blockId).toBe("b0");
    expect(evidence?.matchType).toBe("conceptual");
    expect(evidence?.surfaceTerms.length).toBeGreaterThan(1);
    expect(evidence?.ranges.length).toBe(evidence?.surfaceTerms.length);
  });

  it("ranks the assigned strategy that links the matched intent signal", () => {
    const blocks = [
      {
        id: "b0",
        text: "We need a partner for manual system integration across our logistics platform.",
      },
    ];
    const quality = computeQualityScoreCore(
      { notes: blocks[0]!.text },
      playbook,
      { evidenceBlocks: blocks },
    );
    const matches = rankAssignedStrategies({
      page: {
        text: blocks[0]!.text,
        title: "Logistics modernization RFP",
        industry: "Logistics",
        blocks,
      },
      quality,
      assignments: [
        {
          id: "assignment-1",
          strategyId: "strategy-1",
          assignmentType: "primary",
          priority: 2,
          allocationPct: 70,
        },
        {
          id: "assignment-2",
          strategyId: "strategy-2",
          assignmentType: "secondary",
          priority: 1,
          allocationPct: 30,
        },
      ],
      strategies: [
        {
          id: "strategy-1",
          name: "Integration opportunities",
          version: 3,
          priority: 2,
          status: "published",
          personaIds: [],
          linkedSignals: [
            {
              signalId: "integration",
              enabled: true,
              priority: 5,
              required: true,
              strength: "strong",
            },
          ],
          firmographics: {
            targetIndustries: ["Logistics"],
            excludedIndustries: [],
            targetCountries: [],
            excludedCountries: [],
            targetRegions: [],
            requiredKeywords: [],
            excludedKeywords: [],
          },
        },
        {
          id: "strategy-2",
          name: "Hiring opportunities",
          version: 1,
          priority: 1,
          status: "published",
          personaIds: [],
          linkedSignals: [
            {
              signalId: "hiring",
              enabled: true,
              priority: 5,
              required: true,
            },
          ],
          firmographics: {
            targetIndustries: [],
            excludedIndustries: [],
            targetCountries: [],
            excludedCountries: [],
            targetRegions: [],
            requiredKeywords: [],
            excludedKeywords: [],
          },
        },
      ],
      personas: [],
    });

    expect(quality.matchedSignals.map((signal) => signal.signalId)).toContain("integration");
    expect(matches[0]).toMatchObject({
      strategyId: "strategy-1",
      strategyAssignmentId: "assignment-1",
      missingRequiredSignalIds: [],
      opportunityLabel: "Integrations and Automation",
    });
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score);
  });

  it("hard-disqualifies an assigned strategy on excluded evidence", () => {
    const quality = computeQualityScoreCore(
      { notes: "Manual system integration for a gambling platform." },
      playbook,
    );
    const [match] = rankAssignedStrategies({
      page: { text: "Manual system integration for a gambling platform." },
      quality,
      assignments: [
        {
          id: "assignment-1",
          strategyId: "strategy-1",
          assignmentType: "primary",
          priority: 1,
          allocationPct: 100,
        },
      ],
      strategies: [
        {
          id: "strategy-1",
          name: "Integration",
          version: 1,
          priority: 1,
          status: "published",
          personaIds: [],
          linkedSignals: [
            { signalId: "integration", enabled: true, priority: 5, required: true },
          ],
          firmographics: {
            targetIndustries: [],
            excludedIndustries: [],
            targetCountries: [],
            excludedCountries: [],
            targetRegions: [],
            requiredKeywords: [],
            excludedKeywords: ["gambling"],
          },
        },
      ],
      personas: [],
    });
    expect(match).toMatchObject({ score: 0, disqualified: true });
  });
});
