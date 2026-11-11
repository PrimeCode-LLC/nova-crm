import { describe, expect, it } from "vitest";
import {
  applyStrategyFields,
  blankStrategy,
  describeProposal,
  formatAssistantContext,
  mergeMissingFields,
  missingSegments,
  planAssignmentChanges,
  strategyAssistantOutputSchema,
  validateProposal,
  type AssistantContext,
  type StrategyAssistantOutput,
  type StrategyFields,
} from "./assistant";
import { emptyFirmographics, type ProspectingStrategy, type StrategyAssignment } from "./types";

const NOW = "2026-11-11T10:00:00.000Z";

function strategy(over: Partial<ProspectingStrategy> = {}): ProspectingStrategy {
  return {
    id: "ps-1",
    organizationId: "org-1",
    name: "Texas logistics",
    ownerId: "u-1",
    status: "draft",
    priority: 50,
    personaIds: [],
    firmographics: { ...emptyFirmographics(), targetCountries: ["US"] },
    linkedSignals: [],
    qualityChecklist: [
      { id: "qc-0", fieldKey: "companyName", label: "Company name", requirement: "required", sortOrder: 0 },
    ],
    dailyTargetDefault: 150,
    version: 1,
    createdBy: "u-1",
    updatedBy: "u-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function assignment(over: Partial<StrategyAssignment>): StrategyAssignment {
  return {
    id: "sa-1",
    organizationId: "org-1",
    strategyId: "ps-1",
    userId: "u-ali",
    assignmentType: "primary",
    priority: 100,
    allocationPct: 100,
    status: "active",
    assignedBy: "u-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function noFields(over: Partial<StrategyFields> = {}): StrategyFields {
  const empty = Object.fromEntries(
    Object.keys(strategyAssistantOutputSchema.shape.proposal.unwrap().shape.fields.shape).map((k) => [k, null]),
  ) as StrategyFields;
  return { ...empty, ...over };
}

type RawProposal = NonNullable<StrategyAssistantOutput["proposal"]>;
function raw(over: Partial<RawProposal> = {}): RawProposal {
  return {
    summary: "Change",
    action: "update",
    strategyId: "ps-1",
    fields: noFields(),
    status: null,
    assignments: null,
    removeAssignmentUserIds: null,
    fillEverything: false,
    ...over,
  };
}

const ctx: AssistantContext = {
  focusStrategyId: "ps-1",
  strategies: [strategy(), strategy({ id: "ps-2", name: "Healthcare" })],
  assignments: [assignment({ id: "sa-ali-2", strategyId: "ps-2", userId: "u-ali", allocationPct: 40 })],
  personas: [{ id: "bp-ops", name: "Ops director", titles: ["Director of Operations"] }],
  signals: [{ id: "sig-warehouse", label: "New warehouse", category: "expansion" }],
  users: [
    { id: "u-ali", name: "Ali Khan" },
    { id: "u-sara", name: "Sara Malik" },
  ],
};

describe("strategy assistant: validateProposal", () => {
  it("keeps a 30/70 split and maps a name the model used instead of an id", () => {
    const { proposal, warnings } = validateProposal(
      raw({
        assignments: [
          { userName: "", userId: "u-ali", allocationPct: 30, targetOverride: null, assignmentType: "secondary" },
          { userName: "", userId: "sara malik", allocationPct: 70, targetOverride: null, assignmentType: "primary" },
        ],
      }),
      ctx,
    );
    expect(proposal?.assignments.map((a) => [a.userId, a.allocationPct])).toEqual([
      ["u-ali", 30],
      ["u-sara", 70],
    ]);
    // Ali already has 40% elsewhere (40 + 30); Sara has nothing else (70).
    expect(warnings).toEqual([
      "Ali Khan would total 70% across all strategies (aim for 100%).",
      "Sara Malik would total 70% across all strategies (aim for 100%).",
    ]);
  });

  it("drops unknown people, personas, signals and out-of-range allocations", () => {
    const { proposal, warnings } = validateProposal(
      raw({
        fields: noFields({
          personaIds: ["bp-ops", "bp-made-up"],
          linkedSignals: [
            { signalId: "sig-warehouse", priority: 140, required: true, recencyDays: 90, strength: "strong", instructions: null, messageAngle: null },
            { signalId: "sig-nope", priority: 1, required: false, recencyDays: null, strength: null, instructions: null, messageAngle: null },
          ],
        }),
        assignments: [
          { userName: "", userId: "u-ghost", allocationPct: 50, targetOverride: null, assignmentType: "primary" },
          { userName: "", userId: "u-sara", allocationPct: 0, targetOverride: null, assignmentType: "primary" },
        ],
      }),
      ctx,
    );
    expect(proposal?.fields.personaIds).toEqual(["bp-ops"]);
    expect(proposal?.fields.linkedSignals?.map((s) => [s.signalId, s.priority])).toEqual([["sig-warehouse", 100]]);
    expect(proposal?.assignments).toEqual([]);
    expect(warnings).toHaveLength(4);
  });

  it("rejects updates to a strategy that doesn't exist", () => {
    const { proposal, warnings } = validateProposal(raw({ strategyId: "ps-missing" }), {
      ...ctx,
      focusStrategyId: null,
    });
    expect(proposal).toBeNull();
    expect(warnings[0]).toMatch(/doesn't exist/);
  });

  it("uses the focused strategy when the model leaves strategyId empty", () => {
    const { proposal } = validateProposal(raw({ strategyId: null, fields: noFields({ priority: 80 }) }), ctx);
    expect(proposal?.strategyId).toBe("ps-1");
  });

  it("skips a send window that ends before it starts", () => {
    const { proposal, warnings } = validateProposal(
      raw({ fields: noFields({ sendWindowStartHour: 14, sendWindowEndHour: 10 }) }),
      ctx,
    );
    expect(proposal).toBeNull(); // nothing left to change
    expect(warnings).toEqual(["The send window ended before it started, so it was skipped."]);
  });

  it("can't set the per-strategy timezone the editor no longer offers", () => {
    expect(Object.keys(strategyAssistantOutputSchema.shape.proposal.unwrap().shape.fields.shape)).not.toContain(
      "audienceTimezone",
    );
  });

  it("names a new strategy when the model forgot to", () => {
    const { proposal } = validateProposal(raw({ action: "create", strategyId: null }), ctx);
    expect(proposal?.fields.name).toBe("Untitled strategy");
    expect(proposal?.strategyId).toBeNull();
  });
});

describe("strategy assistant: only real changes", () => {
  it("drops fields, status and assignments that already match what is saved", () => {
    const saved = strategy({
      status: "published",
      searchTemplates: [{ id: "st-1", label: "LinkedIn", queries: ["ops director texas"] }],
    });
    const { proposal } = validateProposal(
      raw({
        fields: noFields({
          name: "Texas logistics",
          targetCountries: ["US"],
          searchTemplates: [{ label: "LinkedIn", queries: ["ops director texas"] }],
          priority: 80,
        }),
        status: "published",
        assignments: [
          { userName: "", userId: "u-ali", allocationPct: 100, targetOverride: null, assignmentType: "primary" },
        ],
      }),
      { ...ctx, strategies: [saved], assignments: [assignment({ userId: "u-ali" })] },
    );
    expect(Object.entries(proposal!.fields).filter(([, v]) => v !== null)).toEqual([["priority", 80]]);
    expect(proposal!.status).toBeNull();
    expect(proposal!.assignments).toEqual([]);
  });

  it("returns no proposal when nothing would change", () => {
    const { proposal } = validateProposal(
      raw({ fields: noFields({ name: "Texas logistics" }), status: "draft" }),
      ctx,
    );
    expect(proposal).toBeNull();
  });
});

describe("strategy assistant: applyStrategyFields", () => {
  it("changes only non-null fields and keeps the rest", () => {
    const next = applyStrategyFields(
      strategy(),
      noFields({ objective: "Book 20 meetings", targetIndustries: [" Logistics ", ""], companySizeMin: "51-200" }),
      null,
      "u-2",
      NOW,
    );
    expect(next.objective).toBe("Book 20 meetings");
    expect(next.firmographics.targetIndustries).toEqual(["Logistics"]);
    expect(next.firmographics.targetCountries).toEqual(["US"]);
    expect(next.firmographics.companySizeMin).toBe("51-200");
    expect(next.name).toBe("Texas logistics");
    expect(next.updatedBy).toBe("u-2");
  });

  it("bumps the version when re-publishing, like the Publish button", () => {
    expect(applyStrategyFields(strategy({ status: "published", version: 3 }), noFields(), "published", "u-1", NOW).version).toBe(4);
    const first = applyStrategyFields(strategy(), noFields(), "published", "u-1", NOW);
    expect([first.status, first.version, first.publishedAt]).toEqual(["published", 1, NOW]);
  });

  it("drops empty search templates and keeps known checklist field keys", () => {
    const next = applyStrategyFields(
      strategy(),
      noFields({
        searchTemplates: [
          { label: "LinkedIn", queries: ["site:linkedin.com ops director", " "] },
          { label: "Empty", queries: [] },
        ],
        qualityChecklist: [
          { label: "Company name", requirement: "required", instructions: null },
          { label: "Warehouse evidence URL", requirement: "optional", instructions: "Link the news" },
        ],
      }),
      null,
      "u-1",
      NOW,
    );
    expect(next.searchTemplates?.map((t) => t.queries)).toEqual([["site:linkedin.com ops director"]]);
    expect(next.qualityChecklist.map((c) => [c.fieldKey, c.sortOrder])).toEqual([
      ["companyName", 0],
      ["warehouse_evidence_url", 1],
    ]);
  });
});

describe("strategy assistant: planAssignmentChanges", () => {
  it("updates people already on the strategy, adds new ones, removes listed ones", () => {
    const plan = planAssignmentChanges({
      strategyId: "ps-1",
      existing: [
        assignment({ id: "sa-ali", userId: "u-ali" }),
        assignment({ id: "sa-old", userId: "u-old" }),
        assignment({ id: "sa-ended", userId: "u-sara", status: "ended" }),
      ],
      assignments: [
        { userId: "u-ali", allocationPct: 30, targetOverride: null, assignmentType: "secondary" },
        { userId: "u-sara", allocationPct: 70, targetOverride: 100, assignmentType: "primary" },
      ],
      removeUserIds: ["u-old"],
    });
    expect(plan.update.map((u) => u.id)).toEqual(["sa-ali"]);
    expect(plan.add.map((a) => a.userId)).toEqual(["u-sara"]);
    expect(plan.remove).toEqual(["sa-old"]);
  });
});

describe("strategy assistant: describeProposal", () => {
  it("shows names, not ids", () => {
    const { proposal } = validateProposal(
      raw({
        fields: noFields({ personaIds: ["bp-ops"] }),
        assignments: [{ userName: "", userId: "u-sara", allocationPct: 70, targetOverride: null, assignmentType: "primary" }],
      }),
      ctx,
    );
    const lines = describeProposal(proposal!, ctx);
    expect(lines).toContainEqual({ label: "Buyer personas", value: "Ops director" });
    expect(lines).toContainEqual({ label: "Assign", value: "Sara Malik: 70% (primary)" });
  });
});

describe("strategy assistant: short refs and cleanup", () => {
  it("trusts the person's name over a mixed-up ref", () => {
    const { proposal } = validateProposal(
      raw({
        assignments: [
          { userName: "Sara Malik", userId: "U1", allocationPct: 50, targetOverride: 25, assignmentType: "secondary" },
        ],
      }),
      ctx,
    );
    expect(proposal?.assignments[0]).toMatchObject({ userId: "u-sara", targetOverride: 25 });
  });

  it("resolves U/P/S refs from the prompt back to real ids", () => {
    const { proposal } = validateProposal(
      raw({
        fields: noFields({
          personaIds: ["P1"],
          linkedSignals: [
            { signalId: "S1", priority: 80, required: true, recencyDays: 90, strength: "strong", instructions: null, messageAngle: null },
          ],
          sopMarkdown: "1. Open My Strategy\\n2. Research",
        }),
        assignments: [{ userName: "", userId: "U2", allocationPct: 70, targetOverride: null, assignmentType: "primary" }],
        removeAssignmentUserIds: ["U1"],
      }),
      ctx,
    );
    expect(proposal?.fields.personaIds).toEqual(["bp-ops"]);
    expect(proposal?.fields.linkedSignals?.[0]?.signalId).toBe("sig-warehouse");
    expect(proposal?.assignments[0]?.userId).toBe("u-sara");
    expect(proposal?.removeAssignmentUserIds).toEqual(["u-ali"]);
    expect(proposal?.fields.sopMarkdown).toBe("1. Open My Strategy\n2. Research");
  });

  it("lists people, personas and signals by ref in the prompt, not by id", () => {
    const text = formatAssistantContext({ ...ctx, focusStrategyId: null });
    expect(text).toContain('"ref":"U1","name":"Ali Khan"');
    expect(text).toContain('"ref":"P1","name":"Ops director"');
    expect(text).toContain('"ref":"S1","label":"New warehouse"');
    expect(text).toContain('"50 to 500 employees" -> min "11-50", max "201-500"');
  });
});

describe("strategy assistant: completeness", () => {
  const blank = () => blankStrategy({ id: "ps-new", organizationId: "org-1", userId: "u-1", now: NOW });

  it("reports every empty segment of a new strategy", () => {
    const labels = missingSegments(blank(), ctx).map((m) => m.label);
    expect(labels).toEqual([
      "Name", "Short description", "Business objective", "Mission blurb", "Preferred send window", "Target industries", "Excluded industries", "Target countries",
      "Regions / states", "Company size range", "Revenue range", "Required keywords", "Excluded keywords",
      "Good company examples", "Disqualified examples", "Buyer personas", "Intent signals",
      "Search templates", "Daily targets", "Industry mix", "SOP / daily process", "Research notes",
    ]);
  });

  it("skips personas and signals when the workspace has none", () => {
    const labels = missingSegments(blank(), { personas: [], signals: [] }).map((m) => m.label);
    expect(labels).not.toContain("Buyer personas");
    expect(labels).not.toContain("Intent signals");
  });

  it("only takes fill-pass values for the keys that were empty", () => {
    const merged = mergeMissingFields(
      noFields({ name: "Texas logistics", targetIndustries: ["Logistics"] }),
      noFields({ name: "Other name", researchNotes: "Check LinkedIn first", excludedKeywords: [] }),
      ["researchNotes", "excludedKeywords"],
    );
    expect(merged.name).toBe("Texas logistics");
    expect(merged.researchNotes).toBe("Check LinkedIn first");
    expect(merged.excludedKeywords).toBeNull();
  });
});
