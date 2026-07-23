import type {
  BuyerPersona,
  ProspectingStrategy,
  QualityChecklistItem,
} from "@/lib/prospecting-strategy/types";
import { emptyFirmographics } from "@/lib/prospecting-strategy/types";
import type {
  StrategyDailyTargets,
  StrategyIndustryAllocation,
  StrategySearchTemplate,
} from "@/lib/prospecting-strategy/qualify";
import { DEFAULT_DAILY_TARGETS } from "@/lib/prospecting-strategy/qualify";

export const STRATEGY_PACK_VERSION = 1 as const;

/** Persona as stored in a portable pack (no org / audit fields). */
export type StrategyPackPersona = Omit<
  BuyerPersona,
  "organizationId" | "createdBy" | "createdAt" | "updatedAt"
>;

/** Strategy as stored in a portable pack (personaRefs instead of personaIds). */
export type StrategyPackStrategy = Omit<
  ProspectingStrategy,
  | "organizationId"
  | "ownerId"
  | "createdBy"
  | "updatedBy"
  | "createdAt"
  | "updatedAt"
  | "publishedAt"
  | "personaIds"
> & {
  /** Local persona ids from this pack - remapped on import. */
  personaRefs: string[];
};

export type StrategyPack = {
  packVersion: typeof STRATEGY_PACK_VERSION;
  packId: string;
  name: string;
  description?: string;
  personas: StrategyPackPersona[];
  strategy: StrategyPackStrategy;
};

export type MaterializePackContext = {
  organizationId: string;
  userId: string;
  /** Generate new entity ids (prefix-aware). */
  newId: (prefix: string) => string;
  /**
   * When true, keep pack-local ids when possible (re-seed / overwrite).
   * Default false: always mint new ids so imports are unique per org.
   */
  preserveIds?: boolean;
};

export type MaterializePackResult = {
  personas: BuyerPersona[];
  strategy: ProspectingStrategy;
  /** pack persona id → new persona id */
  personaIdMap: Record<string, string>;
  warnings: string[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function stripPersona(p: BuyerPersona): StrategyPackPersona {
  const {
    organizationId: _o,
    createdBy: _c,
    createdAt: _ca,
    updatedAt: _ua,
    ...rest
  } = p;
  return rest;
}

function stripStrategy(
  s: ProspectingStrategy,
  personaRefs: string[],
): StrategyPackStrategy {
  const {
    organizationId: _o,
    ownerId: _own,
    createdBy: _c,
    updatedBy: _u,
    createdAt: _ca,
    updatedAt: _ua,
    publishedAt: _p,
    personaIds: _pids,
    ...rest
  } = s;
  return { ...rest, personaRefs };
}

/** Build a portable pack from live strategy + linked personas. */
export function strategyToPack(args: {
  packId: string;
  name?: string;
  description?: string;
  strategy: ProspectingStrategy;
  personas: BuyerPersona[];
}): StrategyPack {
  const linked = args.personas.filter((p) => args.strategy.personaIds.includes(p.id));
  const personaRefs = linked.map((p) => p.id);
  return {
    packVersion: STRATEGY_PACK_VERSION,
    packId: args.packId,
    name: args.name ?? args.strategy.name,
    description: args.description ?? args.strategy.description,
    personas: linked.map(stripPersona),
    strategy: stripStrategy(args.strategy, personaRefs),
  };
}

/** Empty canonical template - use as the shape for every new pack. */
export function emptyStrategyPackTemplate(): StrategyPack {
  return {
    packVersion: STRATEGY_PACK_VERSION,
    packId: "template-empty",
    name: "Empty strategy pack template",
    description:
      "Canonical pack shape. Fill personas + strategy, then Import on Strategies. Remove fields you do not need; keep packVersion = 1.",
    personas: [
      {
        id: "persona-local-1",
        name: "Example Buyer Persona",
        description: "Replace with a real buyer description.",
        department: "Operations",
        seniority: "VP / Director",
        titles: [
          { title: "VP Operations", kind: "approved" },
          { title: "Recruiter", kind: "excluded" },
        ],
        industries: [],
        countries: [],
        responsibilities: [],
        businessGoals: [],
        painPoints: [],
        buyingTriggers: [],
        objections: [],
        relevantServices: [],
        relevantSignalIds: [],
        recommendedAngle: "Replace with the outreach angle for this persona.",
        priority: 100,
        active: true,
      },
    ],
    strategy: {
      id: "strategy-local-1",
      name: "Untitled strategy",
      description: "Short description shown on My Strategy.",
      objective: "What this strategy is trying to achieve.",
      missionBlurb:
        "Why we prospect, how we qualify, and the four questions every prospect must answer.",
      status: "draft",
      priority: 50,
      personaRefs: ["persona-local-1"],
      firmographics: {
        ...emptyFirmographics(),
        targetIndustries: ["Example Industry"],
        excludedIndustries: [],
        targetCountries: ["United States"],
        targetRegions: [],
        companyExamples: "Good-fit company examples…",
        disqualifiedExamples: "Disqualified examples…",
      },
      linkedSignals: [],
      qualityChecklist: [
        {
          id: "qc-1",
          fieldKey: "companyName",
          label: "Company name + website",
          requirement: "required",
          sortOrder: 0,
        },
      ],
      sopMarkdown: "## Daily process\n1. …\n",
      researchNotes: "Where to look and how to validate.",
      searchTemplates: [
        {
          id: "st-1",
          label: "Example queries",
          queries: ['"example signal" company 2026'],
        },
      ],
      dailyTargets: { ...DEFAULT_DAILY_TARGETS },
      industryAllocations: [{ label: "Example Industry", target: 50 }],
      dailyTargetDefault: 150,
      version: 1,
    },
  };
}

export function parseStrategyPack(
  raw: unknown,
): { ok: true; pack: StrategyPack } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Pack must be a JSON object" };
  if (raw.packVersion !== 1 && raw.packVersion !== STRATEGY_PACK_VERSION) {
    return { ok: false, error: `Unsupported packVersion (expected ${STRATEGY_PACK_VERSION})` };
  }
  if (typeof raw.packId !== "string" || !raw.packId.trim()) {
    return { ok: false, error: "packId is required" };
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { ok: false, error: "name is required" };
  }
  if (!Array.isArray(raw.personas)) {
    return { ok: false, error: "personas must be an array" };
  }
  if (!isRecord(raw.strategy)) {
    return { ok: false, error: "strategy must be an object" };
  }

  const personas: StrategyPackPersona[] = [];
  for (const [i, p] of raw.personas.entries()) {
    if (!isRecord(p) || typeof p.id !== "string" || typeof p.name !== "string") {
      return { ok: false, error: `personas[${i}] needs id and name` };
    }
    personas.push({
      id: p.id,
      name: p.name,
      description: typeof p.description === "string" ? p.description : undefined,
      department: typeof p.department === "string" ? p.department : undefined,
      seniority: typeof p.seniority === "string" ? p.seniority : undefined,
      titles: Array.isArray(p.titles)
        ? (p.titles as BuyerPersona["titles"]).filter(
            (t) =>
              t &&
              typeof t === "object" &&
              typeof (t as { title?: string }).title === "string",
          )
        : [],
      industries: asStringArray(p.industries),
      countries: asStringArray(p.countries),
      companySizeMin: p.companySizeMin as BuyerPersona["companySizeMin"],
      companySizeMax: p.companySizeMax as BuyerPersona["companySizeMax"],
      responsibilities: asStringArray(p.responsibilities),
      businessGoals: asStringArray(p.businessGoals),
      painPoints: asStringArray(p.painPoints),
      buyingTriggers: asStringArray(p.buyingTriggers),
      objections: asStringArray(p.objections),
      relevantServices: asStringArray(p.relevantServices),
      relevantSignalIds: asStringArray(p.relevantSignalIds),
      recommendedAngle:
        typeof p.recommendedAngle === "string" ? p.recommendedAngle : undefined,
      valueProposition:
        typeof p.valueProposition === "string" ? p.valueProposition : undefined,
      callToAction: typeof p.callToAction === "string" ? p.callToAction : undefined,
      personalizationNotes:
        typeof p.personalizationNotes === "string" ? p.personalizationNotes : undefined,
      goodExamples: typeof p.goodExamples === "string" ? p.goodExamples : undefined,
      badExamples: typeof p.badExamples === "string" ? p.badExamples : undefined,
      priority: typeof p.priority === "number" ? p.priority : 50,
      active: p.active !== false,
    });
  }

  const s = raw.strategy;
  if (typeof s.name !== "string" || !s.name.trim()) {
    return { ok: false, error: "strategy.name is required" };
  }

  const personaRefs = asStringArray(s.personaRefs);
  if (!personaRefs.length && personas.length) {
    personaRefs.push(...personas.map((p) => p.id));
  }

  const firmographics = isRecord(s.firmographics)
    ? {
        ...emptyFirmographics(),
        ...(s.firmographics as ProspectingStrategy["firmographics"]),
      }
    : emptyFirmographics();

  const qualityChecklist: QualityChecklistItem[] = Array.isArray(s.qualityChecklist)
    ? (s.qualityChecklist as QualityChecklistItem[])
    : [];

  const searchTemplates: StrategySearchTemplate[] | undefined = Array.isArray(
    s.searchTemplates,
  )
    ? (s.searchTemplates as StrategySearchTemplate[])
    : undefined;

  const industryAllocations: StrategyIndustryAllocation[] | undefined = Array.isArray(
    s.industryAllocations,
  )
    ? (s.industryAllocations as StrategyIndustryAllocation[])
    : undefined;

  const dailyTargets: StrategyDailyTargets | undefined = isRecord(s.dailyTargets)
    ? ({ ...DEFAULT_DAILY_TARGETS, ...(s.dailyTargets as StrategyDailyTargets) } as StrategyDailyTargets)
    : undefined;

  const pack: StrategyPack = {
    packVersion: STRATEGY_PACK_VERSION,
    packId: String(raw.packId).trim(),
    name: String(raw.name).trim(),
    description: typeof raw.description === "string" ? raw.description : undefined,
    personas,
    strategy: {
      id: typeof s.id === "string" ? s.id : "strategy-local-1",
      name: s.name.trim(),
      description: typeof s.description === "string" ? s.description : undefined,
      objective: typeof s.objective === "string" ? s.objective : undefined,
      missionBlurb: typeof s.missionBlurb === "string" ? s.missionBlurb : undefined,
      status:
        s.status === "published" ||
        s.status === "paused" ||
        s.status === "archived" ||
        s.status === "draft"
          ? s.status
          : "draft",
      priority: typeof s.priority === "number" ? s.priority : 50,
      personaRefs,
      firmographics,
      linkedSignals: Array.isArray(s.linkedSignals)
        ? (s.linkedSignals as ProspectingStrategy["linkedSignals"])
        : [],
      qualityChecklist,
      sopMarkdown: typeof s.sopMarkdown === "string" ? s.sopMarkdown : undefined,
      researchNotes: typeof s.researchNotes === "string" ? s.researchNotes : undefined,
      searchTemplates,
      dailyTargets,
      industryAllocations,
      dailyTargetDefault:
        typeof s.dailyTargetDefault === "number" ? s.dailyTargetDefault : 150,
      version: typeof s.version === "number" ? s.version : 1,
    },
  };

  return { ok: true, pack };
}

/** Turn a pack into org-scoped personas + strategy with fresh ids by default. */
export function materializeStrategyPack(
  pack: StrategyPack,
  ctx: MaterializePackContext,
): MaterializePackResult {
  const now = new Date().toISOString();
  const warnings: string[] = [];
  const personaIdMap: Record<string, string> = {};

  const personas: BuyerPersona[] = pack.personas.map((p) => {
    const newId = ctx.preserveIds ? p.id : ctx.newId("bp");
    personaIdMap[p.id] = newId;
    return {
      ...p,
      id: newId,
      organizationId: ctx.organizationId,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
      active: p.active !== false,
    };
  });

  for (const ref of pack.strategy.personaRefs) {
    if (!personaIdMap[ref]) {
      warnings.push(`personaRef "${ref}" not found in pack personas - skipped`);
    }
  }

  const personaIds = pack.strategy.personaRefs
    .map((ref) => personaIdMap[ref])
    .filter(Boolean);

  const strategyId = ctx.preserveIds ? pack.strategy.id : ctx.newId("ps");

  const {
    personaRefs: _refs,
    ...strategyRest
  } = pack.strategy;

  const strategy: ProspectingStrategy = {
    ...strategyRest,
    id: strategyId,
    organizationId: ctx.organizationId,
    ownerId: ctx.userId,
    personaIds,
    version: 1,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
    publishedAt: strategyRest.status === "published" ? now : undefined,
  };

  return { personas, strategy, personaIdMap, warnings };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugifyPackId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "strategy-pack"
  );
}
