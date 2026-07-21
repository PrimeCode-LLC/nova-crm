import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { computeQualityScore } from "@/lib/intent/compute-quality-score";
import { modernizationServicesPlaybook } from "@/lib/intent/playbook-templates";
import { stellixSoftPlaybook } from "@/lib/intent/stellix-soft-playbook";

describe("computeQualityScore", () => {
  it("scores hiring + legacy .NET as ready for outreach (legacy template)", () => {
    const playbook = modernizationServicesPlaybook();
    const result = computeQualityScore(
      {
        hiringSignals: "Hiring for Senior .NET Developers in London",
        toolsUsed: ["ASP.NET", "React"],
        companyIndustry: "Insurance",
        touches: 0,
      },
      playbook,
      { labelNames: [".Net"] },
    );
    assert.ok(result.signalCount >= 2);
    assert.ok(result.score >= playbook.outreachThreshold);
    assert.equal(result.meetsThreshold, true);
  });

  it("Stellix: partner search + demand clears threshold and bypasses category minimum", () => {
    const playbook = stellixSoftPlaybook();
    const result = computeQualityScore(
      {
        triggerEvent:
          "Seeking software development partner; also addressing technical debt on aging platform",
        touches: 0,
      },
      playbook,
    );
    assert.ok(result.matchedSignals.some((s) => s.signalId === "stellix_partner_search"));
    assert.ok(result.score >= playbook.outreachThreshold);
    assert.equal(result.meetsThreshold, true);
    assert.ok(result.primaryOpportunity);
  });

  it("Stellix: hiring alone cannot qualify", () => {
    const playbook = stellixSoftPlaybook();
    const result = computeQualityScore(
      {
        hiringSignals: "Hiring .NET developer and cloud engineer",
        touches: 0,
      },
      playbook,
    );
    assert.ok(result.matchedSignals.some((s) => s.signalId === "stellix_hiring"));
    assert.equal(result.meetsThreshold, false);
    assert.ok(result.qualificationNotes.length > 0);
  });

  it("Stellix: routes primary opportunity to Legacy Modernization", () => {
    const playbook = stellixSoftPlaybook();
    const result = computeQualityScore(
      {
        triggerEvent: "Legacy application modernization program underway",
        painPoints: "Technical debt and fragile legacy system",
        toolsUsed: ["VB.NET", "ASP.NET Web Forms"],
        touches: 0,
      },
      playbook,
    );
    assert.equal(result.primaryOpportunity?.id, "legacy_modernization");
    assert.ok(result.meetsThreshold);
  });

  it("Stellix: scores naturalistic research (hiring, fragmented platforms, acquisition, AI)", () => {
    const playbook = stellixSoftPlaybook();
    const result = computeQualityScore(
      {
        hiringSignals:
          "Hiring software developers experienced in BI and cloud systems; tech team is actively scaling",
        painPoints:
          "Disjointed tech stacks and fragmented platforms; teams are manually rekeying data between systems",
        recentNews:
          "Completed the strategic acquisition of Seez AI and took full ownership of Pinewood North America",
        businessFocus:
          "Cloud-based Automotive Intelligence Platform integrating accounting, sales, CRM, and logistics; deploying AI agent applications",
        touches: 3,
      },
      playbook,
    );
    assert.ok(result.matchedSignals.some((s) => s.signalId === "stellix_hiring"));
    assert.ok(result.matchedSignals.some((s) => s.signalId === "stellix_tech_debt"));
    assert.ok(result.matchedSignals.some((s) => s.signalId === "stellix_manual_pain"));
    assert.ok(result.matchedSignals.some((s) => s.signalId === "stellix_funding"));
    assert.ok(result.score >= playbook.outreachThreshold);
    assert.equal(result.meetsThreshold, true);
    assert.ok(result.primaryOpportunity);
  });

  it("adds engagement boost on reply", () => {
    const playbook = modernizationServicesPlaybook();
    const base = computeQualityScore({ touches: 0 }, playbook);
    const withReply = computeQualityScore(
      { touches: 0, lastReplyAt: "2026-07-18T00:00:00.000Z" },
      playbook,
    );
    assert.ok(withReply.score >= base.score);
    assert.ok(withReply.matchedSignals.some((s) => s.signalId === "engagement_reply"));
  });
});
