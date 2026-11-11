import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown[]>();
const aiOutput = vi.fn();

vi.mock("@/lib/platform/guard-admin-feature", () => ({
  guardAdminFeature: vi.fn(async () => ({
    ok: true,
    ctx: { session: { uid: "u-mgr", organizationId: "org-1", name: "Manager" }, role: "owner" },
    actor: { id: "u-mgr", roleId: "director", displayName: "Manager" },
    roleSnapshot: null,
  })),
}));

vi.mock("@/lib/ai/ai-settings-server", () => ({
  getOrganizationAiSettingsServer: vi.fn(async () => ({ enabled: true })),
  canUseAiFeature: vi.fn(() => true),
  aiFeatureDenialMessage: vi.fn(() => "denied"),
}));

vi.mock("@/lib/ai/run-feature", () => ({
  runAiStructuredFeature: vi.fn(async (input: { promptVars: Record<string, string> }) => ({
    output: aiOutput(input.promptVars),
  })),
  AiForbiddenError: class extends Error {},
  AiNotConfiguredError: class extends Error {},
}));

vi.mock("@/lib/prospecting-strategy/assistant-threads-server", () => ({
  isValidThreadKey: (k: string) => /^[A-Za-z0-9_-]{1,160}$/.test(k),
  loadStrategyAssistantThread: vi.fn(async (_org: string, key: string) => store.get(key) ?? []),
  appendStrategyAssistantMessages: vi.fn(async (_org: string, key: string, add: unknown[]) => {
    store.set(key, [...(store.get(key) ?? []), ...add]);
  }),
  setStrategyAssistantProposalStatus: vi.fn(
    async (input: { threadKey: string; messageId: string; status: string }) => {
      const msg = (store.get(input.threadKey) ?? []).find(
        (m) => (m as { id: string }).id === input.messageId,
      ) as { proposalStatus?: string } | undefined;
      if (!msg || msg.proposalStatus !== "pending") return false;
      msg.proposalStatus = input.status;
      return true;
    },
  ),
}));

import { GET, PATCH, POST } from "./route";

const nullFields = Object.fromEntries(
  [
    "name", "description", "objective", "missionBlurb", "priority", "dailyTargetDefault",
    "sendWindowStartHour", "sendWindowEndHour", "personaIds",
    "targetIndustries", "excludedIndustries", "targetCountries", "excludedCountries",
    "targetRegions", "requiredKeywords", "excludedKeywords", "companySizeMin", "companySizeMax",
    "revenueMin", "revenueMax", "companyExamples", "disqualifiedExamples", "linkedSignals",
    "qualityChecklist", "sopMarkdown", "researchNotes", "searchTemplates", "dailyTargets",
    "industryAllocations",
  ].map((k) => [k, null]),
);

const context = {
  focusStrategyId: "ps-1",
  strategies: [{ id: "ps-1", name: "Texas logistics", status: "draft", priority: 50 }],
  assignments: [],
  personas: [],
  signals: [],
  users: [
    { id: "u-ali", name: "Ali" },
    { id: "u-sara", name: "Sara" },
  ],
};

function req(method: string, body?: unknown, url = "http://x/api/ai/strategy-assistant") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/ai/strategy-assistant", () => {
  beforeEach(() => {
    store.clear();
    aiOutput.mockReset();
  });

  it("saves the chat turn with a validated proposal, then marks it applied once", async () => {
    aiOutput.mockReturnValue({
      reply: "Here's the split.",
      questions: [],
      proposal: {
        summary: "Assign 30% Ali, 70% Sara",
        action: "update",
        strategyId: "ps-1",
        fields: nullFields,
        status: null,
        assignments: [
          { userName: "", userId: "u-ali", allocationPct: 30, targetOverride: null, assignmentType: "secondary" },
          { userName: "", userId: "u-sara", allocationPct: 70, targetOverride: null, assignmentType: "primary" },
          { userName: "", userId: "u-ghost", allocationPct: 10, targetOverride: null, assignmentType: "secondary" },
        ],
        removeAssignmentUserIds: null,
      },
    });

    const res = await POST(req("POST", { threadKey: "ps-1", message: "30% Ali, 70% Sara", context }));
    expect(res.status).toBe(200);
    const { messages } = (await res.json()) as {
      messages: { id: string; role: string; proposal?: { assignments: unknown[] }; proposalStatus?: string; warnings?: string[] }[];
    };
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const assistant = messages[1]!;
    expect(assistant.proposal?.assignments).toHaveLength(2);
    expect(assistant.proposalStatus).toBe("pending");
    expect(assistant.warnings?.some((w) => w.includes("u-ghost"))).toBe(true);

    const history = await GET(req("GET", undefined, "http://x/api/ai/strategy-assistant?thread=ps-1"));
    expect(((await history.json()) as { messages: unknown[] }).messages).toHaveLength(2);

    const patch = { threadKey: "ps-1", messageId: assistant.id, status: "applied", appliedStrategyId: "ps-1" };
    expect((await PATCH(req("PATCH", patch))).status).toBe(200);
    expect((await PATCH(req("PATCH", patch))).status).toBe(409);
  });

  it("sends earlier turns back to the model as conversation", async () => {
    aiOutput.mockReturnValue({ reply: "Sure.", questions: ["What daily target?"], proposal: null });
    await POST(req("POST", { threadKey: "general", message: "First", context: { ...context, focusStrategyId: null } }));
    await POST(req("POST", { threadKey: "general", message: "Second", context: { ...context, focusStrategyId: null } }));
    const vars = aiOutput.mock.calls[1]![0] as Record<string, string>;
    expect(vars.conversation).toContain("Manager: First");
    expect(vars.conversation).toContain("asked: What daily target?");
    expect(vars.userMessage).toBe("Second");
  });

  it("asks the model again for empty segments when creating, and lists what stays empty", async () => {
    aiOutput
      .mockReturnValueOnce({
        reply: "Drafted it.",
        questions: [],
        proposal: {
          summary: "New strategy",
          action: "create",
          strategyId: null,
          fields: { ...nullFields, name: "Texas logistics", targetIndustries: ["Logistics"] },
          status: null,
          assignments: null,
          removeAssignmentUserIds: null,
          fillEverything: true,
        },
      })
      .mockReturnValueOnce({ fields: { ...nullFields, name: "Ignored", researchNotes: "Start with LinkedIn" } });

    const res = await POST(req("POST", { threadKey: "general", message: "Create it", context: { ...context, focusStrategyId: null } }));
    const { messages } = (await res.json()) as {
      messages: { proposal?: { fields: Record<string, unknown> }; questions?: string[] }[];
    };
    const fillVars = aiOutput.mock.calls[1]![0] as Record<string, string>;
    expect(aiOutput).toHaveBeenCalledTimes(2);
    expect(fillVars).toEqual({}); // fill pass uses its own prompt, not the template vars
    const fields = messages[1]!.proposal!.fields;
    expect(fields.name).toBe("Texas logistics");
    expect(fields.researchNotes).toBe("Start with LinkedIn");
    expect(messages[1]!.questions?.at(-1)).toMatch(/still empty: Short description/);
    expect(messages[1]!.questions?.at(-1)).not.toMatch(/Research notes/);
  });

  it("rejects a bad thread key", async () => {
    const res = await POST(req("POST", { threadKey: "../x", message: "hi", context }));
    expect(res.status).toBe(400);
  });
});
