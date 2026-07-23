import type {
  ContentBrandKind,
  ContentCadence,
  ContentCtaType,
  ContentFormat,
  ContentPillar,
  ContentPlatform,
  ContentPrimaryOutcome,
  ContentStrategyStyle,
} from "@/lib/content-calendar/types";

export type ContentStrategyPack = {
  id: string;
  name: string;
  description: string;
  industry: string;
  defaultOutcomeForKind: Record<ContentBrandKind, ContentPrimaryOutcome>;
  defaultStrategyForKind: Record<ContentBrandKind, ContentStrategyStyle>;
  defaultPlatforms: ContentPlatform[];
  defaultFormats: ContentFormat[];
  pillarsForKind: (kind: ContentBrandKind) => ContentPillar[];
  cadence: ContentCadence;
  defaultCtaType: (outcome: ContentPrimaryOutcome) => ContentCtaType;
  voiceSeed: (kind: ContentBrandKind) => {
    positioning: string;
    voiceRules: string;
    bannedPhrases: string[];
    targetAudience: string;
    offersToPromote: string;
  };
  promptSystemExtras: string;
};

const CTA_BY_OUTCOME: Record<ContentPrimaryOutcome, ContentCtaType> = {
  authority_inbound: "book_fit_check",
  business_opportunities: "book_demo",
  partnerships: "soft_dm",
  recruitment: "soft_dm",
  customer_education: "share_lesson",
  community_growth: "reply_with_niche",
  product_awareness: "start_trial",
};

function companyPillars(): ContentPillar[] {
  return [
    {
      key: "proof_case_study",
      name: "Case studies & proof",
      targetPercent: 30,
      allowedCtaTypes: ["book_fit_check", "book_demo", "reply_with_niche", "none"],
      enabled: true,
    },
    {
      key: "operator_lesson",
      name: "Operator / delivery lessons",
      targetPercent: 20,
      allowedCtaTypes: ["share_lesson", "none"],
      enabled: true,
    },
    {
      key: "opinion_take",
      name: "Industry commentary",
      targetPercent: 15,
      allowedCtaTypes: ["reply_with_niche", "none"],
      enabled: true,
    },
    {
      key: "product_education",
      name: "Product education",
      targetPercent: 15,
      allowedCtaTypes: ["book_demo", "start_trial", "none"],
      enabled: true,
    },
    {
      key: "soft_cta",
      name: "Soft CTA / offer",
      targetPercent: 10,
      allowedCtaTypes: ["book_fit_check", "book_demo", "soft_dm"],
      enabled: true,
    },
    {
      key: "culture",
      name: "Company culture",
      targetPercent: 10,
      allowedCtaTypes: ["none", "soft_dm"],
      enabled: true,
    },
    {
      key: "personal_journey",
      name: "Founder journey",
      targetPercent: 0,
      allowedCtaTypes: ["none"],
      enabled: false,
    },
  ];
}

function founderPillars(): ContentPillar[] {
  return [
    {
      key: "personal_journey",
      name: "Founder journey",
      targetPercent: 35,
      allowedCtaTypes: ["share_lesson", "none"],
      enabled: true,
    },
    {
      key: "operator_lesson",
      name: "Practical lessons",
      targetPercent: 25,
      allowedCtaTypes: ["share_lesson", "none"],
      enabled: true,
    },
    {
      key: "proof_case_study",
      name: "Case studies & proof",
      targetPercent: 20,
      allowedCtaTypes: ["book_fit_check", "share_lesson", "none"],
      enabled: true,
    },
    {
      key: "opinion_take",
      name: "Industry commentary",
      targetPercent: 10,
      allowedCtaTypes: ["reply_with_niche", "none"],
      enabled: true,
    },
    {
      key: "soft_cta",
      name: "Soft CTA / offer",
      targetPercent: 10,
      allowedCtaTypes: ["book_fit_check", "soft_dm", "none"],
      enabled: true,
    },
    {
      key: "product_education",
      name: "Product education",
      targetPercent: 0,
      allowedCtaTypes: ["none"],
      enabled: false,
    },
    {
      key: "culture",
      name: "Company culture",
      targetPercent: 0,
      allowedCtaTypes: ["none"],
      enabled: false,
    },
  ];
}

function productPillars(): ContentPillar[] {
  return [
    {
      key: "product_education",
      name: "Product education",
      targetPercent: 35,
      allowedCtaTypes: ["start_trial", "book_demo", "none"],
      enabled: true,
    },
    {
      key: "proof_case_study",
      name: "Case studies & proof",
      targetPercent: 25,
      allowedCtaTypes: ["book_demo", "start_trial", "none"],
      enabled: true,
    },
    {
      key: "operator_lesson",
      name: "How-to / workflows",
      targetPercent: 20,
      allowedCtaTypes: ["share_lesson", "none"],
      enabled: true,
    },
    {
      key: "soft_cta",
      name: "Soft CTA / offer",
      targetPercent: 15,
      allowedCtaTypes: ["start_trial", "book_demo"],
      enabled: true,
    },
    {
      key: "opinion_take",
      name: "Industry commentary",
      targetPercent: 5,
      allowedCtaTypes: ["none"],
      enabled: true,
    },
    {
      key: "personal_journey",
      name: "Founder journey",
      targetPercent: 0,
      allowedCtaTypes: ["none"],
      enabled: false,
    },
    {
      key: "culture",
      name: "Company culture",
      targetPercent: 0,
      allowedCtaTypes: ["none"],
      enabled: false,
    },
  ];
}

export const B2B_AGENCY_STRATEGY_PACK: ContentStrategyPack = {
  id: "b2b_agency_v1",
  name: "B2B services / SaaS",
  description:
    "Authority and pipeline for company/product brands; founder journey for personal brands. Proof-first posts from real work.",
  industry: "B2B services / SaaS",
  defaultOutcomeForKind: {
    company: "authority_inbound",
    founder: "authority_inbound",
    product: "product_awareness",
    employee: "community_growth",
    community: "community_growth",
  },
  defaultStrategyForKind: {
    company: "case_studies",
    founder: "build_in_public",
    product: "educational",
    employee: "educational",
    community: "industry_commentary",
  },
  defaultPlatforms: ["linkedin", "x"],
  defaultFormats: ["text_post", "thread"],
  pillarsForKind: (kind) => {
    if (kind === "founder") return founderPillars();
    if (kind === "product") return productPillars();
    return companyPillars();
  },
  cadence: {
    postsPerWeek: { linkedin: 3, x: 5, instagram: 2, reddit: 1 },
    preferredWeekdays: [1, 2, 3, 4],
    weeklyPublishTarget: 5,
  },
  defaultCtaType: (outcome) => CTA_BY_OUTCOME[outcome],
  voiceSeed: (kind) => {
    if (kind === "founder") {
      return {
        positioning:
          "A technology founder documenting real decisions, client lessons, experiments, and the work behind building a software company.",
        voiceRules:
          "First-person, direct, and practical. Start with a real situation. Share what happened, what was learned, and what others can apply. Avoid guru tone and fake vulnerability.",
        bannedPhrases: ["hustle harder", "crush it", "10x your", "game-changer", "guru", "passive income"],
        targetAudience:
          "Founders, operators, and technical leaders who care about shipping, sales, and building companies.",
        offersToPromote: "Soft mentions of the company/product when relevant to the lesson.",
      };
    }
    if (kind === "product") {
      return {
        positioning:
          "A B2B SaaS product that helps teams run a clearer, faster go-to-market and delivery workflow. Content teaches useful workflows and proves outcomes.",
        voiceRules:
          "Clear, specific product education. Lead with the user problem, show the workflow, and end with a low-pressure next step. Never invent metrics.",
        bannedPhrases: ["revolutionary", "AI-powered magic", "world-class", "synergy", "game-changer"],
        targetAudience: "Ops, sales, and product teams evaluating tools to improve execution.",
        offersToPromote: "Demo, trial, or walkthrough of the core workflow.",
      };
    }
    return {
      positioning:
        "An enterprise software and automation partner helping organizations modernize systems, connect operational data, and ship reliable digital platforms.",
      voiceRules:
        "Confident, practical, and technically credible. Start with a real business problem, then explain the engineering insight and impact. Soft CTAs only after proof.",
      bannedPhrases: [
        "game-changer",
        "synergy",
        "revolutionary",
        "just checking in",
        "leverage",
        "world-class",
        "cutting-edge",
      ],
      targetAudience:
        "Mid-market and enterprise leaders responsible for modernization, operations, and software delivery.",
      offersToPromote: "Fit Check, discovery call, or case-study walkthrough.",
    };
  },
  promptSystemExtras: `Industry: B2B services / SaaS.
Best practices:
- Hook in the first line (problem, contrast, or concrete number).
- One idea per post; platform-native length and formatting.
- LinkedIn: short paragraphs, scannable, professional but human.
- X: punchy; threads only when the idea needs steps.
- Prefer verified case-study proof from knowledge when pillar is proof.
- Never invent client names, metrics, or logos not in knowledge.
- Soft CTAs only — no hard sell spam.
- Fill strategic gaps (missing pillars / outcomes), not empty calendar cells.`,
};

export const CONTENT_STRATEGY_PACKS: Record<string, ContentStrategyPack> = {
  [B2B_AGENCY_STRATEGY_PACK.id]: B2B_AGENCY_STRATEGY_PACK,
};

export function getContentStrategyPack(id: string): ContentStrategyPack {
  return CONTENT_STRATEGY_PACKS[id] ?? B2B_AGENCY_STRATEGY_PACK;
}

export function buildBrandDefaultsFromPack(input: {
  kind: ContentBrandKind;
  name: string;
  strategyPackId?: string;
  primaryOutcome?: ContentPrimaryOutcome;
  contentStrategy?: ContentStrategyStyle;
  platforms?: ContentPlatform[];
}): {
  primaryOutcome: ContentPrimaryOutcome;
  contentStrategy: ContentStrategyStyle;
  strategyPackId: string;
  platforms: ContentPlatform[];
  pillars: ContentPillar[];
  cadence: ContentCadence;
  defaultCtaType: ContentCtaType;
  defaultFormats: ContentFormat[];
  positioning: string;
  voiceRules: string;
  bannedPhrases: string[];
  targetAudience: string;
  offersToPromote: string;
  topicsToAvoid: string[];
  referenceCreators: string;
  approvalRequired: boolean;
} {
  const pack = getContentStrategyPack(input.strategyPackId ?? "b2b_agency_v1");
  const primaryOutcome = input.primaryOutcome ?? pack.defaultOutcomeForKind[input.kind];
  const contentStrategy = input.contentStrategy ?? pack.defaultStrategyForKind[input.kind];
  const voice = pack.voiceSeed(input.kind);
  return {
    primaryOutcome,
    contentStrategy,
    strategyPackId: pack.id,
    platforms: input.platforms?.length ? input.platforms : pack.defaultPlatforms,
    pillars: pack.pillarsForKind(input.kind),
    cadence: pack.cadence,
    defaultCtaType: pack.defaultCtaType(primaryOutcome),
    defaultFormats: [...pack.defaultFormats],
    positioning: voice.positioning,
    voiceRules: voice.voiceRules,
    bannedPhrases: voice.bannedPhrases,
    targetAudience: voice.targetAudience,
    offersToPromote: voice.offersToPromote,
    topicsToAvoid: [],
    referenceCreators: "",
    approvalRequired: input.kind === "company",
  };
}
