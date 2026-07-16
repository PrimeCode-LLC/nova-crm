export type FollowupRoleFamily =
  | "executive"
  | "technical_executive"
  | "technical_practitioner"
  | "operations"
  | "revenue"
  | "finance"
  | "people"
  | "general";

export type FollowupPersonalizationProfile = {
  designation: string | null;
  seniority: string | null;
  roleFamily: FollowupRoleFamily;
  communicationStrategy: string;
  targetEmailWords: string;
  emphasize: string[];
  avoid: string[];
};

const ROLE_RULES: {
  family: FollowupRoleFamily;
  pattern: RegExp;
  strategy: Omit<
    FollowupPersonalizationProfile,
    "designation" | "seniority" | "roleFamily"
  >;
}[] = [
  {
    family: "technical_executive",
    pattern:
      /\b(cto|cio|ciso|chief (technology|technical|information|information security|digital) officer)\b|\b(vp|vice president|head|director)\b.*\b(engineering|technology|technical|it|platform|infrastructure|data|security)\b/i,
    strategy: {
      communicationStrategy:
        "Lead with the technical or operational consequence, then give one credible implementation detail and a low-friction next step.",
      targetEmailWords: "70-120 words",
      emphasize: ["architecture fit", "integration effort", "security", "delivery risk"],
      avoid: ["unsupported technical claims", "feature dumps", "generic ROI language"],
    },
  },
  {
    family: "executive",
    pattern:
      /\b(ceo|founder|co-founder|cofounder|owner|president|managing director|chief executive|general manager)\b/i,
    strategy: {
      communicationStrategy:
        "Get to the business point immediately: one relevant signal, one outcome, and one easy decision or question.",
      targetEmailWords: "45-85 words",
      emphasize: ["business outcome", "strategic relevance", "risk", "speed"],
      avoid: ["theory", "long setup", "feature lists", "multiple calls to action"],
    },
  },
  {
    family: "technical_practitioner",
    pattern:
      /\b(engineer|engineering manager|developer|architect|programmer|devops|sre|data scientist|technical lead|tech lead|it manager|qa|quality assurance|security analyst|administrator)\b/i,
    strategy: {
      communicationStrategy:
        "Use concrete technical language, explain the mechanism or workflow briefly, and make the next step useful to a practitioner.",
      targetEmailWords: "80-140 words",
      emphasize: ["workflow", "technical mechanism", "compatibility", "developer effort"],
      avoid: ["empty business jargon", "unverifiable architecture assumptions", "vague claims"],
    },
  },
  {
    family: "operations",
    pattern:
      /\b(coo|operations|operational|delivery|program manager|project manager|process|customer success|support)\b/i,
    strategy: {
      communicationStrategy:
        "Connect the observed situation to a process bottleneck, then show the practical efficiency or reliability improvement.",
      targetEmailWords: "65-110 words",
      emphasize: ["time saved", "process reliability", "adoption", "bottlenecks"],
      avoid: ["abstract strategy", "technical detail without operational impact", "feature dumps"],
    },
  },
  {
    family: "revenue",
    pattern:
      /\b(sales|revenue|growth|marketing|demand generation|business development|partnerships|account executive|cro|cmo)\b/i,
    strategy: {
      communicationStrategy:
        "Tie the strongest signal to pipeline or growth impact, give one measurable value hypothesis, and ask a direct question.",
      targetEmailWords: "60-105 words",
      emphasize: ["pipeline", "conversion", "speed", "attribution"],
      avoid: ["generic growth promises", "too many metrics", "indirect calls to action"],
    },
  },
  {
    family: "finance",
    pattern:
      /\b(cfo|finance|financial|controller|accounting|procurement|purchasing|commercial director)\b/i,
    strategy: {
      communicationStrategy:
        "Frame the message around economic impact, predictability, or risk and keep every claim measurable or clearly hypothetical.",
      targetEmailWords: "60-100 words",
      emphasize: ["ROI", "cost", "risk", "predictability", "compliance"],
      avoid: ["unquantified savings claims", "technical detail without financial impact", "hype"],
    },
  },
  {
    family: "people",
    pattern:
      /\b(chro|human resources|people|talent|recruit|hr|learning and development|l&d)\b/i,
    strategy: {
      communicationStrategy:
        "Relate the signal to hiring, employee workflow, or team capacity and focus on practical human impact.",
      targetEmailWords: "65-110 words",
      emphasize: ["team capacity", "candidate or employee experience", "adoption", "time saved"],
      avoid: ["impersonal automation language", "unsupported culture assumptions", "feature dumps"],
    },
  },
];

const GENERAL_STRATEGY = {
  communicationStrategy:
    "Lead with the strongest verified signal, connect it to the recipient's likely responsibilities without assuming facts, and ask one simple question.",
  targetEmailWords: "60-110 words",
  emphasize: ["role relevance", "specific value", "clarity"],
  avoid: ["generic compliments", "invented pain points", "multiple calls to action"],
};

export function buildFollowupPersonalizationProfile(input: {
  title?: string;
  seniority?: string;
}): FollowupPersonalizationProfile {
  const designation = input.title?.trim() || null;
  const seniority = input.seniority?.trim() || null;
  const matchedRule = designation
    ? ROLE_RULES.find((rule) => rule.pattern.test(designation))
    : undefined;

  return {
    designation,
    seniority,
    roleFamily: matchedRule?.family ?? "general",
    ...(matchedRule?.strategy ?? GENERAL_STRATEGY),
  };
}
