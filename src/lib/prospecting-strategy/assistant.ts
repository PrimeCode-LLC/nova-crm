/**
 * Strategy AI assistant: the model only *proposes* changes. Proposals are
 * validated here against the workspace's real strategies / people / personas /
 * signals, shown to the manager, and applied client-side through the same
 * `useProspectingStrategyData` writers the Strategies pages use.
 */
import { z } from "zod";
import type { CompanySize, RevenueRange } from "@/lib/types";
import { allocationTotal, activeAssignmentsForUser } from "@/lib/prospecting-strategy/allocation";
import { DEFAULT_CHECKLIST } from "@/lib/prospecting-strategy/seed";
import {
  emptyFirmographics,
  resolveDailyTargets,
  type ProspectingStrategy,
  type ProspectingStrategyStatus,
  type QualityChecklistItem,
  type StrategyAssignment,
  type StrategyAssignmentType,
} from "@/lib/prospecting-strategy/types";

const COMPANY_SIZES = [
  "solo", "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+",
] as const satisfies readonly CompanySize[];
const REVENUE_RANGES = [
  "lt_1m", "1m_10m", "10m_50m", "50m_100m", "100m_500m", "500m_1b", "gt_1b", "unknown",
] as const satisfies readonly RevenueRange[];
const STATUSES = ["draft", "published", "paused", "archived"] as const satisfies readonly ProspectingStrategyStatus[];

// OpenAI structured output is strict: every property required, so "leave unchanged" is `null`.
const text = z.string().nullable();
const list = z.array(z.string()).nullable();
const num = z.number().nullable();

export const strategyFieldsSchema = z.object({
  name: text,
  description: text,
  objective: text,
  missionBlurb: text,
  priority: num,
  dailyTargetDefault: num,
  // No audienceTimezone: the editor no longer exposes it (sequences use the
  // workspace timezone), so the assistant must not set it either.
  sendWindowStartHour: num,
  sendWindowEndHour: num,
  personaIds: list,
  targetIndustries: list,
  excludedIndustries: list,
  targetCountries: list,
  excludedCountries: list,
  targetRegions: list,
  requiredKeywords: list,
  excludedKeywords: list,
  companySizeMin: z.enum(COMPANY_SIZES).nullable(),
  companySizeMax: z.enum(COMPANY_SIZES).nullable(),
  revenueMin: z.enum(REVENUE_RANGES).nullable(),
  revenueMax: z.enum(REVENUE_RANGES).nullable(),
  companyExamples: text,
  disqualifiedExamples: text,
  linkedSignals: z
    .array(
      z.object({
        signalId: z.string(),
        priority: z.number(),
        required: z.boolean(),
        recencyDays: num,
        strength: z.enum(["strong", "medium"]).nullable(),
        instructions: text,
        messageAngle: text,
      }),
    )
    .nullable(),
  qualityChecklist: z
    .array(
      z.object({
        label: z.string(),
        requirement: z.enum(["required", "optional", "not_needed"]),
        instructions: text,
      }),
    )
    .nullable(),
  sopMarkdown: text,
  researchNotes: text,
  searchTemplates: z.array(z.object({ label: z.string(), queries: z.array(z.string()) })).nullable(),
  dailyTargets: z
    .object({
      completed: z.number(),
      uniqueCompanies: z.number(),
      maxContactsPerCompany: z.number(),
      verifiedEmails: z.number(),
      withEvidence: z.number(),
      withRecentSignal: z.number(),
      warm: z.number(),
      hot: z.number(),
      deeplyPersonalized: z.number(),
    })
    .nullable(),
  industryAllocations: z.array(z.object({ label: z.string(), target: z.number() })).nullable(),
});

export type StrategyFields = z.infer<typeof strategyFieldsSchema>;

export const strategyAssistantOutputSchema = z.object({
  reply: z.string(),
  questions: z.array(z.string()),
  proposal: z
    .object({
      summary: z.string(),
      action: z.enum(["create", "update"]),
      strategyId: text,
      fields: strategyFieldsSchema,
      status: z.enum(STATUSES).nullable(),
      assignments: z
        .array(
          z.object({
            userId: z.string(),
            /** Name as written in the team list; cross-checks the ref. */
            userName: z.string(),
            allocationPct: z.number(),
            targetOverride: num,
            assignmentType: z.enum(["primary", "secondary"]),
          }),
        )
        .nullable(),
      removeAssignmentUserIds: list,
      /** True when the manager asked to create a strategy or to fill/complete one. */
      fillEverything: z.boolean(),
    })
    .nullable(),
});

/** Second pass: fill only the segments the first answer left empty. */
export const strategyFillOutputSchema = z.object({ fields: strategyFieldsSchema });

export type StrategyAssistantOutput = z.infer<typeof strategyAssistantOutputSchema>;

export type ProposalAssignment = {
  userId: string;
  allocationPct: number;
  targetOverride: number | null;
  assignmentType: StrategyAssignmentType;
};

/** A proposal after validation: unknown ids dropped, numbers clamped. */
export type StrategyProposal = {
  summary: string;
  action: "create" | "update";
  strategyId: string | null;
  fields: StrategyFields;
  status: ProspectingStrategyStatus | null;
  assignments: ProposalAssignment[];
  removeAssignmentUserIds: string[];
};

export type AssistantContext = {
  /** Strategy the chat is about (detail page), or null on the list page. */
  focusStrategyId: string | null;
  strategies: ProspectingStrategy[];
  assignments: StrategyAssignment[];
  personas: { id: string; name: string; titles: string[] }[];
  signals: { id: string; label: string; category: string }[];
  users: { id: string; name: string }[];
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// The prompt lists people / personas / signals as short refs (U1, P2, S3): small
// models copy those far more reliably than long ids. Real ids and exact names
// are still accepted.
const REF_PREFIX = { users: "U", personas: "P", signals: "S" } as const;

function resolveRef(
  raw: string,
  items: readonly { id: string; name?: string; label?: string }[],
  prefix: string,
): string | null {
  const v = raw.trim();
  const ref = new RegExp(`^${prefix}(\\d+)$`, "i").exec(v);
  if (ref) return items[Number(ref[1]) - 1]?.id ?? null;
  const exact = items.find((i) => i.id === v);
  if (exact) return exact.id;
  const needle = v.toLowerCase();
  const byName = items.filter((i) => (i.name ?? i.label ?? "").trim().toLowerCase() === needle);
  return byName.length === 1 ? byName[0]!.id : null;
}

function resolveUserId(raw: string, users: AssistantContext["users"]): string | null {
  return resolveRef(raw, users, REF_PREFIX.users);
}

/** Models sometimes double-escape newlines inside JSON strings. */
function unescapeText(v: string | null): string | null {
  return v === null ? null : v.replace(/\\n/g, "\n").replace(/\\t/g, "  ");
}

export function userName(ctx: Pick<AssistantContext, "users">, id: string): string {
  return ctx.users.find((u) => u.id === id)?.name || id;
}

export function hasFieldChanges(fields: StrategyFields): boolean {
  return Object.values(fields).some((v) => v !== null);
}

/** Checks a raw model proposal against the workspace; returns what is safe to show and apply. */
export function validateProposal(
  raw: StrategyAssistantOutput["proposal"],
  ctx: AssistantContext,
): { proposal: StrategyProposal | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw) return { proposal: null, warnings };

  let strategyId: string | null = null;
  if (raw.action === "update") {
    strategyId = raw.strategyId ?? ctx.focusStrategyId;
    if (!strategyId || !ctx.strategies.some((s) => s.id === strategyId)) {
      warnings.push("The AI referred to a strategy that doesn't exist, so its change was dropped.");
      return { proposal: null, warnings };
    }
  }

  const f: StrategyFields = { ...raw.fields };
  for (const key of [
    "name", "description", "objective", "missionBlurb", "companyExamples",
    "disqualifiedExamples", "sopMarkdown", "researchNotes",
  ] as const) {
    f[key] = unescapeText(f[key]);
  }

  if (f.personaIds) {
    const resolved = f.personaIds.map((r) => resolveRef(r, ctx.personas, REF_PREFIX.personas));
    const known = [...new Set(resolved.filter((id): id is string => id !== null))];
    if (resolved.some((id) => id === null)) warnings.push("Unknown buyer personas were skipped.");
    f.personaIds = known;
  }
  if (f.linkedSignals) {
    const known: NonNullable<StrategyFields["linkedSignals"]> = [];
    for (const s of f.linkedSignals) {
      const signalId = resolveRef(s.signalId, ctx.signals, REF_PREFIX.signals);
      if (!signalId || known.some((k) => k.signalId === signalId)) continue;
      known.push({
        ...s,
        signalId,
        priority: clamp(Math.round(s.priority), 0, 100),
        recencyDays: s.recencyDays === null ? null : clamp(Math.round(s.recencyDays), 1, 3650),
      });
    }
    if (known.length < f.linkedSignals.length) warnings.push("Unknown Intent Playbook signals were skipped.");
    f.linkedSignals = known;
  }
  if (f.priority !== null) f.priority = clamp(Math.round(f.priority), 0, 100);
  if (f.dailyTargetDefault !== null) f.dailyTargetDefault = clamp(Math.round(f.dailyTargetDefault), 0, 10_000);
  if (f.sendWindowStartHour !== null) f.sendWindowStartHour = clamp(Math.round(f.sendWindowStartHour), 0, 23);
  if (f.sendWindowEndHour !== null) f.sendWindowEndHour = clamp(Math.round(f.sendWindowEndHour), 1, 24);
  if (
    f.sendWindowStartHour !== null &&
    f.sendWindowEndHour !== null &&
    f.sendWindowStartHour >= f.sendWindowEndHour
  ) {
    warnings.push("The send window ended before it started, so it was skipped.");
    f.sendWindowStartHour = null;
    f.sendWindowEndHour = null;
  }
  if (f.dailyTargets) {
    f.dailyTargets = Object.fromEntries(
      Object.entries(f.dailyTargets).map(([k, v]) => [k, clamp(Math.round(v), 0, 10_000)]),
    ) as NonNullable<StrategyFields["dailyTargets"]>;
    // All zeros means the model had nothing to say; treat it as not filled.
    if (f.dailyTargets.completed === 0) f.dailyTargets = null;
  }
  if (f.industryAllocations) {
    f.industryAllocations = f.industryAllocations.filter((a) => a.label.trim() && a.target > 0);
  }

  const assignments: ProposalAssignment[] = [];
  for (const a of raw.assignments ?? []) {
    // People talk in names, and small models mix up refs: when the name the
    // model wrote matches exactly one teammate, that wins over the ref.
    const byName = a.userName ? resolveUserId(a.userName, ctx.users) : null;
    const userId = byName ?? resolveUserId(a.userId, ctx.users);
    if (!userId) {
      warnings.push(`"${a.userId}" isn't a member of this workspace, so they were skipped.`);
      continue;
    }
    const pct = Math.round(a.allocationPct);
    if (!(pct >= 1 && pct <= 100)) {
      warnings.push(`${userName(ctx, userId)}'s allocation must be between 1 and 100%, so it was skipped.`);
      continue;
    }
    const target = a.targetOverride === null ? null : clamp(Math.round(a.targetOverride), 0, 10_000);
    const row = { userId, allocationPct: pct, targetOverride: target, assignmentType: a.assignmentType };
    const i = assignments.findIndex((x) => x.userId === userId);
    if (i >= 0) assignments[i] = row;
    else assignments.push(row);
  }

  const removeAssignmentUserIds = [
    ...new Set(
      (raw.removeAssignmentUserIds ?? [])
        .map((id) => resolveUserId(id, ctx.users))
        .filter((id): id is string => id !== null && !assignments.some((a) => a.userId === id)),
    ),
  ];

  if (raw.action === "create" && !f.name?.trim()) f.name = "Untitled strategy";

  // Updates: drop anything identical to what is saved, so the card lists only real changes.
  const current = strategyId ? ctx.strategies.find((s) => s.id === strategyId) : undefined;
  if (current) {
    for (const key of Object.keys(f) as (keyof StrategyFields)[]) {
      if (f[key] !== null && sameValue(f[key], currentFieldValue(current, key))) {
        (f as Record<string, unknown>)[key] = null;
      }
    }
    for (let i = assignments.length - 1; i >= 0; i--) {
      const a = assignments[i]!;
      const row = ctx.assignments.find(
        (x) => x.strategyId === strategyId && x.userId === a.userId && x.status === "active",
      );
      if (
        row &&
        row.allocationPct === a.allocationPct &&
        (row.targetOverride ?? null) === a.targetOverride &&
        row.assignmentType === a.assignmentType
      ) {
        assignments.splice(i, 1);
      }
    }
  }
  const status = current && raw.status === current.status ? null : raw.status;

  // Same rule the Assignments tab shows: a person's active allocations should total 100%.
  for (const a of assignments) {
    const others = activeAssignmentsForUser(ctx.assignments, a.userId).filter(
      (row) => row.strategyId !== strategyId,
    );
    const total = allocationTotal(others) + a.allocationPct;
    if (Math.abs(total - 100) > 0.5) {
      warnings.push(`${userName(ctx, a.userId)} would total ${total}% across all strategies (aim for 100%).`);
    }
  }

  const proposal: StrategyProposal = {
    summary: raw.summary,
    action: raw.action,
    strategyId,
    fields: f,
    status,
    assignments,
    removeAssignmentUserIds,
  };
  const empty =
    raw.action === "update" &&
    !hasFieldChanges(f) &&
    !status &&
    assignments.length === 0 &&
    removeAssignmentUserIds.length === 0;
  return { proposal: empty ? null : proposal, warnings };
}

function newLocalId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom";
}

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined && x !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, stable(x)]),
    );
  }
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b ?? null));
}

/** A saved strategy's value in the proposal's field shape (for no-op detection). */
function currentFieldValue(s: ProspectingStrategy, key: keyof StrategyFields): unknown {
  const firmo = s.firmographics as unknown as Record<string, unknown>;
  switch (key) {
    case "linkedSignals":
      return s.linkedSignals.map((x) => ({
        signalId: x.signalId,
        priority: x.priority,
        required: x.required,
        recencyDays: x.recencyDays,
        strength: x.strength,
        instructions: x.instructions,
        messageAngle: x.messageAngle,
      }));
    case "qualityChecklist":
      return s.qualityChecklist.map((c) => ({ label: c.label, requirement: c.requirement, instructions: c.instructions }));
    case "searchTemplates":
      return (s.searchTemplates ?? []).map((t) => ({ label: t.label, queries: t.queries }));
    case "dailyTargets":
      return s.dailyTargets;
    case "industryAllocations":
      return s.industryAllocations ?? [];
    default:
      return key in firmo ? firmo[key] : (s as unknown as Record<string, unknown>)[key];
  }
}

/** Overlays the non-null proposal fields onto a strategy (same cleanup the editor does on save). */
export function applyStrategyFields(
  base: ProspectingStrategy,
  fields: StrategyFields,
  status: ProspectingStrategyStatus | null,
  actorId: string,
  now = new Date().toISOString(),
): ProspectingStrategy {
  const next: ProspectingStrategy = {
    ...base,
    firmographics: { ...base.firmographics },
    updatedBy: actorId,
    updatedAt: now,
  };
  const set = <K extends keyof ProspectingStrategy>(key: K, value: ProspectingStrategy[K] | null) => {
    if (value !== null) next[key] = value;
  };
  set("name", fields.name?.trim() || null);
  set("description", fields.description);
  set("objective", fields.objective);
  set("missionBlurb", fields.missionBlurb);
  set("priority", fields.priority);
  set("dailyTargetDefault", fields.dailyTargetDefault);
  set("sendWindowStartHour", fields.sendWindowStartHour);
  set("sendWindowEndHour", fields.sendWindowEndHour);
  set("personaIds", fields.personaIds);
  set("sopMarkdown", fields.sopMarkdown);
  set("researchNotes", fields.researchNotes);

  const firmo = next.firmographics;
  for (const key of [
    "targetIndustries",
    "excludedIndustries",
    "targetCountries",
    "excludedCountries",
    "targetRegions",
    "requiredKeywords",
    "excludedKeywords",
  ] as const) {
    const v = fields[key];
    if (v !== null) firmo[key] = v.map((s) => s.trim()).filter(Boolean);
  }
  if (fields.companySizeMin !== null) firmo.companySizeMin = fields.companySizeMin;
  if (fields.companySizeMax !== null) firmo.companySizeMax = fields.companySizeMax;
  if (fields.revenueMin !== null) firmo.revenueMin = fields.revenueMin;
  if (fields.revenueMax !== null) firmo.revenueMax = fields.revenueMax;
  if (fields.companyExamples !== null) firmo.companyExamples = fields.companyExamples;
  if (fields.disqualifiedExamples !== null) firmo.disqualifiedExamples = fields.disqualifiedExamples;

  if (fields.linkedSignals) {
    next.linkedSignals = fields.linkedSignals.map((s) => ({
      signalId: s.signalId,
      enabled: true,
      priority: s.priority,
      required: s.required,
      ...(s.recencyDays !== null ? { recencyDays: s.recencyDays } : {}),
      ...(s.strength !== null ? { strength: s.strength } : {}),
      ...(s.instructions ? { instructions: s.instructions } : {}),
      ...(s.messageAngle ? { messageAngle: s.messageAngle } : {}),
    }));
  }
  if (fields.qualityChecklist) {
    next.qualityChecklist = fields.qualityChecklist.map(
      (c, i): QualityChecklistItem => ({
        id: newLocalId("qc"),
        fieldKey: base.qualityChecklist.find((b) => b.label === c.label.trim())?.fieldKey ?? slug(c.label),
        label: c.label.trim() || "Requirement",
        requirement: c.requirement,
        ...(c.instructions ? { instructions: c.instructions } : {}),
        sortOrder: i,
      }),
    );
  }
  if (fields.searchTemplates) {
    const templates = fields.searchTemplates
      .map((t) => ({
        id: newLocalId("st"),
        label: t.label.trim() || "Untitled group",
        queries: t.queries.map((q) => q.trim()).filter(Boolean),
      }))
      .filter((t) => t.queries.length > 0);
    next.searchTemplates = templates.length ? templates : undefined;
  }
  if (fields.dailyTargets) next.dailyTargets = { ...resolveDailyTargets(base), ...fields.dailyTargets };
  if (fields.industryAllocations) {
    const mix = fields.industryAllocations
      .map((a) => ({ label: a.label.trim(), target: a.target }))
      .filter((a) => a.label.length > 0);
    next.industryAllocations = mix.length ? mix : undefined;
  }

  if (status) {
    // Mirrors the editor's Publish button: bump the version on re-publish.
    if (status === "published") {
      next.version = base.status === "published" ? base.version + 1 : Math.max(1, base.version || 1);
      next.publishedAt = now;
    }
    next.status = status;
  }
  return next;
}

/** Splits assignment rows into adds / updates / removals for one strategy. */
export function planAssignmentChanges(input: {
  strategyId: string;
  existing: StrategyAssignment[];
  assignments: ProposalAssignment[];
  removeUserIds: string[];
}): {
  add: ProposalAssignment[];
  update: { id: string; row: ProposalAssignment }[];
  remove: string[];
} {
  const onStrategy = input.existing.filter(
    (a) => a.strategyId === input.strategyId && a.status !== "ended",
  );
  const add: ProposalAssignment[] = [];
  const update: { id: string; row: ProposalAssignment }[] = [];
  for (const row of input.assignments) {
    const current = onStrategy.find((a) => a.userId === row.userId);
    if (current) update.push({ id: current.id, row });
    else add.push(row);
  }
  const remove = onStrategy.filter((a) => input.removeUserIds.includes(a.userId)).map((a) => a.id);
  return { add, update, remove };
}

const SIZE_GUIDE = `Company size buckets (employees): ${COMPANY_SIZES.join(", ")}. Revenue buckets: lt_1m (<$1M), 1m_10m, 10m_50m, 50m_100m, 100m_500m, 500m_1b, gt_1b, unknown.
For a range, companySizeMin / revenueMin = the bucket containing the LOWER bound and companySizeMax / revenueMax = the bucket containing the UPPER bound.
Examples: "50 to 500 employees" -> min "11-50", max "201-500". "200-1000 employees" -> min "51-200", max "501-1000". "$10M-$100M revenue" -> min "10m_50m", max "50m_100m".`;

/** Full strategy details on the list page when they fit; names only otherwise. */
const FULL_STRATEGIES_MAX_CHARS = 60_000;
function fullStrategiesBlock(strategies: object[]): string {
  const full = JSON.stringify(strategies);
  return full.length <= FULL_STRATEGIES_MAX_CHARS
    ? `This chat is on the strategies list page. Full strategy details:\n${full}`
    : "This chat is on the strategies list page (details too large to include; ask which strategy to change).";
}

/** Compact, model-readable snapshot of the workspace for the prompt. */
export function formatAssistantContext(ctx: AssistantContext): string {
  const focus = ctx.focusStrategyId ? ctx.strategies.find((s) => s.id === ctx.focusStrategyId) : undefined;
  const userRef = (id: string) => {
    const i = ctx.users.findIndex((u) => u.id === id);
    return i >= 0 ? `${REF_PREFIX.users}${i + 1}` : id;
  };
  const allocations = ctx.assignments
    .filter((a) => a.status !== "ended")
    .map((a) => ({
      strategyId: a.strategyId,
      user: userRef(a.userId),
      name: userName(ctx, a.userId),
      allocationPct: a.allocationPct,
      targetOverride: a.targetOverride ?? null,
      status: a.status,
    }));
  const hidden = new Set(["organizationId", "createdBy", "updatedBy", "ownerId"]);
  const strip = (s: ProspectingStrategy) =>
    Object.fromEntries(Object.entries(s).filter(([k]) => !hidden.has(k)));
  return [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    focus
      ? `Strategy this chat is about (id ${focus.id}):\n${JSON.stringify(strip(focus))}`
      : fullStrategiesBlock(ctx.strategies.map(strip)),
    `All strategies:\n${JSON.stringify(ctx.strategies.map((s) => ({ id: s.id, name: s.name, status: s.status, priority: s.priority, objective: s.objective ?? null })))}`,
    `Team members (use the ref, e.g. "U1", as userId):\n${JSON.stringify(ctx.users.map((u, i) => ({ ref: `${REF_PREFIX.users}${i + 1}`, name: u.name })))}`,
    `Current assignments:\n${JSON.stringify(allocations)}`,
    `Buyer personas (use the ref, e.g. "P1", in personaIds; pick only personas whose name/titles match):\n${JSON.stringify(ctx.personas.map((p, i) => ({ ref: `${REF_PREFIX.personas}${i + 1}`, name: p.name, titles: p.titles.slice(0, 8) })))}`,
    `Intent Playbook signals (use the ref, e.g. "S1", as signalId):\n${JSON.stringify(ctx.signals.map((s, i) => ({ ref: `${REF_PREFIX.signals}${i + 1}`, label: s.label, category: s.category })))}`,
    SIZE_GUIDE,
  ].join("\n\n");
}

const FIELD_LABELS: Record<keyof StrategyFields, string> = {
  name: "Name",
  description: "Description",
  objective: "Business objective",
  missionBlurb: "Mission blurb",
  priority: "Priority",
  dailyTargetDefault: "Default daily target",
  sendWindowStartHour: "Send window start",
  sendWindowEndHour: "Send window end",
  personaIds: "Buyer personas",
  targetIndustries: "Target industries",
  excludedIndustries: "Excluded industries",
  targetCountries: "Target countries",
  excludedCountries: "Excluded countries",
  targetRegions: "Regions / states",
  requiredKeywords: "Required keywords",
  excludedKeywords: "Excluded keywords",
  companySizeMin: "Min company size",
  companySizeMax: "Max company size",
  revenueMin: "Min revenue",
  revenueMax: "Max revenue",
  companyExamples: "Good company examples",
  disqualifiedExamples: "Disqualified examples",
  linkedSignals: "Intent signals",
  qualityChecklist: "Quality checklist",
  sopMarkdown: "SOP / daily process",
  researchNotes: "Research notes",
  searchTemplates: "Search templates",
  dailyTargets: "Daily targets",
  industryAllocations: "Industry mix",
};

export type ProposalLine = { label: string; value: string };

const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Plain-language lines for the change card. */
export function describeProposal(
  p: StrategyProposal,
  ctx: Pick<AssistantContext, "users" | "personas" | "signals" | "strategies">,
): ProposalLine[] {
  const lines: ProposalLine[] = [];
  const f = p.fields;
  for (const key of Object.keys(FIELD_LABELS) as (keyof StrategyFields)[]) {
    const v = f[key];
    if (v === null) continue;
    let value: string;
    if (key === "personaIds") {
      value = (v as string[]).map((id) => ctx.personas.find((x) => x.id === id)?.name ?? id).join(", ");
    } else if (key === "linkedSignals") {
      value = (v as NonNullable<StrategyFields["linkedSignals"]>)
        .map((s) => {
          const label = ctx.signals.find((x) => x.id === s.signalId)?.label ?? s.signalId;
          return `${label}${s.required ? " (required)" : ""}${s.recencyDays ? `, ≤${s.recencyDays}d` : ""}`;
        })
        .join("; ");
    } else if (key === "qualityChecklist") {
      value = (v as NonNullable<StrategyFields["qualityChecklist"]>)
        .map((c) => `${c.label} (${c.requirement.replace("_", " ")})`)
        .join("; ");
    } else if (key === "searchTemplates") {
      value = (v as NonNullable<StrategyFields["searchTemplates"]>)
        .map((t) => `${t.label}: ${t.queries.length} quer${t.queries.length === 1 ? "y" : "ies"}`)
        .join("; ");
    } else if (key === "dailyTargets") {
      value = Object.entries(v as object).map(([k, n]) => `${k} ${n}`).join(", ");
    } else if (key === "industryAllocations") {
      value = (v as NonNullable<StrategyFields["industryAllocations"]>)
        .map((a) => `${a.label} ${a.target}`)
        .join(", ");
    } else if (Array.isArray(v)) {
      value = v.length ? v.join(", ") : "(cleared)";
    } else {
      value = String(v);
    }
    lines.push({ label: FIELD_LABELS[key], value: short(value || "(cleared)") });
  }
  if (p.status) lines.push({ label: "Status", value: p.status });
  for (const a of p.assignments) {
    lines.push({
      label: "Assign",
      value: `${userName(ctx, a.userId)}: ${a.allocationPct}% (${a.assignmentType})${a.targetOverride !== null ? `, ${a.targetOverride}/day` : ""}`,
    });
  }
  for (const id of p.removeAssignmentUserIds) {
    lines.push({ label: "Remove from strategy", value: userName(ctx, id) });
  }
  return lines;
}

/** Every editable part of a strategy the assistant must cover, in editor tab order. */
const SEGMENTS: { keys: (keyof StrategyFields)[]; label: string; empty: (s: ProspectingStrategy) => boolean }[] = [
  { keys: ["name"], label: "Name", empty: (s) => !s.name.trim() || s.name.trim() === "Untitled strategy" },
  { keys: ["description"], label: "Short description", empty: (s) => !s.description?.trim() },
  { keys: ["objective"], label: "Business objective", empty: (s) => !s.objective?.trim() },
  { keys: ["missionBlurb"], label: "Mission blurb", empty: (s) => !s.missionBlurb?.trim() },
  {
    keys: ["sendWindowStartHour", "sendWindowEndHour"],
    label: "Preferred send window",
    empty: (s) => s.sendWindowStartHour === undefined || s.sendWindowEndHour === undefined,
  },
  { keys: ["targetIndustries"], label: "Target industries", empty: (s) => !s.firmographics.targetIndustries.length },
  { keys: ["excludedIndustries"], label: "Excluded industries", empty: (s) => !s.firmographics.excludedIndustries.length },
  { keys: ["targetCountries"], label: "Target countries", empty: (s) => !s.firmographics.targetCountries.length },
  { keys: ["targetRegions"], label: "Regions / states", empty: (s) => !s.firmographics.targetRegions.length },
  {
    keys: ["companySizeMin", "companySizeMax"],
    label: "Company size range",
    empty: (s) => !s.firmographics.companySizeMin || !s.firmographics.companySizeMax,
  },
  {
    keys: ["revenueMin", "revenueMax"],
    label: "Revenue range",
    empty: (s) => !s.firmographics.revenueMin || !s.firmographics.revenueMax,
  },
  { keys: ["requiredKeywords"], label: "Required keywords", empty: (s) => !s.firmographics.requiredKeywords.length },
  { keys: ["excludedKeywords"], label: "Excluded keywords", empty: (s) => !s.firmographics.excludedKeywords.length },
  { keys: ["companyExamples"], label: "Good company examples", empty: (s) => !s.firmographics.companyExamples?.trim() },
  {
    keys: ["disqualifiedExamples"],
    label: "Disqualified examples",
    empty: (s) => !s.firmographics.disqualifiedExamples?.trim(),
  },
  { keys: ["personaIds"], label: "Buyer personas", empty: (s) => !s.personaIds.length },
  { keys: ["linkedSignals"], label: "Intent signals", empty: (s) => !s.linkedSignals.length },
  { keys: ["searchTemplates"], label: "Search templates", empty: (s) => !s.searchTemplates?.length },
  { keys: ["dailyTargets"], label: "Daily targets", empty: (s) => !s.dailyTargets },
  { keys: ["industryAllocations"], label: "Industry mix", empty: (s) => !s.industryAllocations?.length },
  { keys: ["qualityChecklist"], label: "Quality checklist", empty: (s) => !s.qualityChecklist.length },
  { keys: ["sopMarkdown"], label: "SOP / daily process", empty: (s) => !s.sopMarkdown?.trim() },
  { keys: ["researchNotes"], label: "Research notes", empty: (s) => !s.researchNotes?.trim() },
];

/** Segments still empty on a strategy (personas/signals only when the workspace has any). */
export function missingSegments(
  s: ProspectingStrategy,
  ctx: Pick<AssistantContext, "personas" | "signals">,
): { keys: (keyof StrategyFields)[]; label: string }[] {
  return SEGMENTS.filter((seg) => {
    if (seg.keys[0] === "personaIds" && ctx.personas.length === 0) return false;
    if (seg.keys[0] === "linkedSignals" && ctx.signals.length === 0) return false;
    return seg.empty(s);
  }).map(({ keys, label }) => ({ keys, label }));
}

/** Same starting point as the "New strategy" button. */
export function blankStrategy(input: {
  id: string;
  organizationId: string;
  userId: string;
  now: string;
}): ProspectingStrategy {
  return {
    id: input.id,
    organizationId: input.organizationId,
    name: "Untitled strategy",
    ownerId: input.userId,
    status: "draft",
    priority: 50,
    personaIds: [],
    firmographics: emptyFirmographics(),
    linkedSignals: [],
    qualityChecklist: DEFAULT_CHECKLIST,
    dailyTargetDefault: 150,
    version: 1,
    createdBy: input.userId,
    updatedBy: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Takes the fill-pass values only for keys that were empty after the first answer. */
export function mergeMissingFields(
  fields: StrategyFields,
  fill: StrategyFields,
  keys: readonly (keyof StrategyFields)[],
): StrategyFields {
  const next: StrategyFields = { ...fields };
  for (const key of keys) {
    const v = fill[key];
    if (v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim())) continue;
    (next as Record<string, unknown>)[key] = v;
  }
  return next;
}
