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
  /** Likely buying-committee role + how to write for it (never name the label in the email). */
  committeeHint: string;
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
        "Open with the technical or delivery consequence of the observed signal, add one credible implementation detail, and close with a low-friction interest check - not a calendar demand.",
      committeeHint:
        "Usually the technical evaluator or a key champion; give them proof that de-risks the technical decision and something they can forward to the economic buyer.",
      targetEmailWords: "70-120 words",
      emphasize: [
        "architecture fit",
        "integration effort",
        "security",
        "delivery risk",
        "implementation clarity",
      ],
      avoid: [
        "unsupported technical claims",
        "feature dumps",
        "generic ROI language",
        "executive fluff",
      ],
    },
  },
  {
    family: "executive",
    pattern:
      /\b(ceo|founder|co-founder|cofounder|owner|president|managing director|chief executive|general manager)\b/i,
    strategy: {
      communicationStrategy:
        "Lead with one verified signal and one business outcome in the first two lines, then ask a yes/no or one-sentence decision question. No setup, no feature tour.",
      committeeHint:
        "Usually the economic buyer or final decision-maker; at larger accounts they often delegate, so keep it outcome-first and easy to forward to a lieutenant. At founder-led SMBs they decide directly - a concrete next step can come sooner.",
      targetEmailWords: "45-85 words",
      emphasize: ["business outcome", "strategic relevance", "risk", "speed", "decision clarity"],
      avoid: ["theory", "long setup", "feature lists", "multiple calls to action", "technical deep-dives"],
    },
  },
  {
    family: "technical_practitioner",
    pattern:
      /\b(engineer|engineering manager|developer|architect|programmer|devops|sre|data scientist|technical lead|tech lead|it manager|qa|quality assurance|security analyst|administrator)\b/i,
    strategy: {
      communicationStrategy:
        "Speak like a peer: name the mechanism or workflow, show why it matters to their day-to-day, and offer a concrete artifact (example, pattern, or short walkthrough) rather than a sales meeting.",
      committeeHint:
        "Usually a hands-on evaluator or internal influencer, not the signer; win them with practical usefulness so they champion you upward.",
      targetEmailWords: "80-140 words",
      emphasize: ["workflow", "technical mechanism", "compatibility", "developer effort", "practical example"],
      avoid: ["empty business jargon", "unverifiable architecture assumptions", "vague claims", "hard calendar asks on first touch"],
    },
  },
  {
    family: "operations",
    pattern:
      /\b(coo|operations|operational|delivery|program manager|project manager|process|customer success|support)\b/i,
    strategy: {
      communicationStrategy:
        "Connect the observed situation to a process bottleneck, quantify friction in plain language when evidence allows, and ask whether a lighter workflow would be useful.",
      committeeHint:
        "Often the champion who feels the pain daily and builds the internal case; give them forwardable proof of time saved and reliability.",
      targetEmailWords: "65-110 words",
      emphasize: ["time saved", "process reliability", "adoption", "bottlenecks", "handoffs"],
      avoid: ["abstract strategy", "technical detail without operational impact", "feature dumps"],
    },
  },
  {
    family: "revenue",
    pattern:
      /\b(sales|revenue|growth|marketing|demand generation|business development|partnerships|account executive|cro|cmo)\b/i,
    strategy: {
      communicationStrategy:
        "Tie the strongest signal to pipeline, conversion, or speed; give one measurable value hypothesis; ask a direct one-sentence question they can answer from their desk.",
      committeeHint:
        "Often an economic buyer or strong champion for revenue tools; lead with the number that matters and make it easy to justify upward.",
      targetEmailWords: "60-105 words",
      emphasize: ["pipeline", "conversion", "speed", "attribution", "reply or meeting rate"],
      avoid: ["generic growth promises", "too many metrics", "indirect calls to action"],
    },
  },
  {
    family: "finance",
    pattern:
      /\b(cfo|finance|financial|controller|accounting|procurement|purchasing|commercial director)\b/i,
    strategy: {
      communicationStrategy:
        "Frame around economic impact, predictability, or risk. Mark any number as evidence-backed or clearly hypothetical. Ask a scoping question, not a vague 'chat'.",
      committeeHint:
        "Usually the economic buyer or procurement gatekeeper; reduce perceived risk and give defensible numbers they can stand behind internally.",
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
        "Relate the signal to hiring capacity, candidate/employee experience, or team workflow. Keep the ask human and low-pressure.",
      committeeHint:
        "Often the champion or user-buyer for people tools; give them a human, forwardable case for capacity and experience gains.",
      targetEmailWords: "65-110 words",
      emphasize: ["team capacity", "candidate or employee experience", "adoption", "time saved"],
      avoid: ["impersonal automation language", "unsupported culture assumptions", "feature dumps"],
    },
  },
];

const GENERAL_STRATEGY = {
  communicationStrategy:
    "Lead with the strongest verified signal, connect it lightly to the recipient's likely responsibilities without inventing facts, and ask one simple interest-check question.",
  committeeHint:
    "Committee role unclear: write it to be useful and forwardable to whoever decides - outcome-first, no assumptions about their authority.",
  targetEmailWords: "60-110 words",
  emphasize: ["role relevance", "specific value", "clarity", "easy reply"],
  avoid: ["generic compliments", "invented pain points", "multiple calls to action"],
};

/** Compact block for prompt vars so the model cannot miss role constraints. */
export function formatFollowupRoleGuidance(profile: FollowupPersonalizationProfile): string {
  const designation = profile.designation || "unknown title";
  const seniority = profile.seniority || "unknown seniority";
  return [
    `Role family: ${profile.roleFamily}`,
    `Designation: ${designation}`,
    `Seniority: ${seniority}`,
    `Strategy: ${profile.communicationStrategy}`,
    `Likely committee role: ${profile.committeeHint}`,
    `Target length: ${profile.targetEmailWords}`,
    `Emphasize: ${profile.emphasize.join(", ")}`,
    `Avoid: ${profile.avoid.join(", ")}`,
  ].join("\n");
}

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
