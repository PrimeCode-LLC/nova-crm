/** Content Calendar domain types (tenant-scoped Firestore docs). */

export type ContentPlatform = "linkedin" | "x" | "instagram" | "reddit";

/** Who the brand represents. */
export type ContentBrandKind =
  | "company"
  | "founder"
  | "product"
  | "employee"
  | "community";

/** Business outcome this brand is optimizing for. */
export type ContentPrimaryOutcome =
  | "authority_inbound"
  | "business_opportunities"
  | "partnerships"
  | "recruitment"
  | "customer_education"
  | "community_growth"
  | "product_awareness";

/** How content is styled / positioned strategically. */
export type ContentStrategyStyle =
  | "thought_leadership"
  | "build_in_public"
  | "case_studies"
  | "educational"
  | "founder_journey"
  | "company_culture"
  | "industry_commentary";

export type ContentFormat =
  | "text_post"
  | "graphic_post"
  | "thread"
  | "carousel"
  | "short_video"
  | "long_form";

/**
 * Full content workflow.
 * Legacy values (planned/draft/ready/posted) are normalized in map-docs.
 */
export type ContentItemStatus =
  | "idea"
  | "research"
  | "draft"
  | "fact_check"
  | "review"
  | "approved"
  | "scheduled"
  | "published"
  | "repurpose"
  | "skipped";

export type ContentPillarKey =
  | "proof_case_study"
  | "operator_lesson"
  | "opinion_take"
  | "soft_cta"
  | "personal_journey"
  | "product_education"
  | "culture";

export type ContentCtaType =
  | "book_fit_check"
  | "reply_with_niche"
  | "soft_dm"
  | "share_lesson"
  | "book_demo"
  | "start_trial"
  | "none";

export type ContentPlanStatus = "draft" | "approved" | "generating" | "completed" | "cancelled";

export type ContentCaptureStatus = "draft" | "normalized" | "indexed" | "failed";

export interface ContentCadence {
  /** Target posts per week per platform. */
  postsPerWeek: Partial<Record<ContentPlatform, number>>;
  /** 0=Sun … 6=Sat preferred publish weekdays. */
  preferredWeekdays: number[];
  /** Overall weekly publishing target across platforms. */
  weeklyPublishTarget?: number;
}

export interface ContentPillar {
  key: ContentPillarKey;
  name: string;
  targetPercent: number;
  allowedCtaTypes: ContentCtaType[];
  enabled: boolean;
}

export interface ContentBrand {
  id: string;
  organizationId: string;
  name: string;
  kind: ContentBrandKind;
  /** @deprecated Use primaryOutcome — kept for older docs via map-docs. */
  goal?: ContentPrimaryOutcome | string;
  primaryOutcome: ContentPrimaryOutcome;
  contentStrategy: ContentStrategyStyle;
  strategyPackId: string;
  platforms: ContentPlatform[];
  positioning: string;
  voiceRules: string;
  bannedPhrases: string[];
  targetAudience: string;
  offersToPromote: string;
  topicsToAvoid: string[];
  referenceCreators: string;
  /** Where proof comes from (case studies, docs, founder notes, etc.). */
  proofSources: string;
  preferredCtas: string;
  defaultFormats: ContentFormat[];
  approvalRequired: boolean;
  knowledgeLibraryIds: string[];
  knowledgeDocumentIds?: string[];
  pillars: ContentPillar[];
  cadence: ContentCadence;
  defaultCtaType: ContentCtaType;
  promptOverrides?: {
    extraSystemInstructions?: string;
  };
  ownerUserId: string;
  defaultOwnerUserId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentVariant {
  platform: ContentPlatform;
  body: string;
  hook?: string;
  format?: ContentFormat;
}

export interface ContentRagCitation {
  title: string;
  excerpt: string;
  documentId?: string;
  libraryId?: string;
}

export interface ContentItem {
  id: string;
  organizationId: string;
  brandId: string;
  pillarKey: ContentPillarKey;
  publishAt: string;
  dueAt: string;
  status: ContentItemStatus;
  title: string;
  angle: string;
  /** Why this topic was chosen (from plan). */
  rationale?: string;
  format?: ContentFormat;
  platforms: ContentPlatform[];
  variants: ContentVariant[];
  ctaType: ContentCtaType;
  ragCitations?: ContentRagCitation[];
  /** True when drafts used retrieved knowledge. */
  verifiedFromKnowledge?: boolean;
  blockerNote?: string;
  assigneeUserId: string;
  ownerUserId: string;
  planId?: string;
  captureId?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentCapture {
  id: string;
  organizationId: string;
  brandId?: string;
  problem: string;
  solution: string;
  outcome?: string;
  notes?: string;
  publicSafe: boolean;
  status: ContentCaptureStatus;
  normalizedTitle?: string;
  normalizedMarkdown?: string;
  knowledgeDocumentId?: string;
  libraryId?: string;
  queueForPosts?: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export interface ContentPlanSlot {
  id: string;
  publishAt: string;
  platform: ContentPlatform;
  pillarKey: ContentPillarKey;
  title: string;
  angle: string;
  proofHint: string;
  ctaType: ContentCtaType;
  rationale?: string;
  format?: ContentFormat;
  targetAudienceHint?: string;
  approved: boolean;
  contentItemId?: string;
}

export interface ContentPlan {
  id: string;
  organizationId: string;
  brandId: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  platforms: ContentPlatform[];
  status: ContentPlanStatus;
  planSummary: string;
  slots: ContentPlanSlot[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export const CONTENT_PLATFORM_LABELS: Record<ContentPlatform, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  reddit: "Reddit",
};

export const CONTENT_BRAND_KIND_LABELS: Record<ContentBrandKind, string> = {
  company: "Company",
  founder: "Founder / Executive",
  product: "Product",
  employee: "Employee",
  community: "Community",
};

export const CONTENT_OUTCOME_LABELS: Record<ContentPrimaryOutcome, string> = {
  authority_inbound: "Authority and inbound leads",
  business_opportunities: "Business opportunities",
  partnerships: "Partnerships",
  recruitment: "Recruitment",
  customer_education: "Customer education",
  community_growth: "Community growth",
  product_awareness: "Product awareness",
};

export const CONTENT_STRATEGY_LABELS: Record<ContentStrategyStyle, string> = {
  thought_leadership: "Thought leadership",
  build_in_public: "Build in public",
  case_studies: "Case studies",
  educational: "Educational content",
  founder_journey: "Founder journey",
  company_culture: "Company culture",
  industry_commentary: "Industry commentary",
};

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  text_post: "Text post",
  graphic_post: "Graphic post",
  thread: "Thread",
  carousel: "Carousel",
  short_video: "Short video",
  long_form: "Long-form",
};

export const CONTENT_STATUS_LABELS: Record<ContentItemStatus, string> = {
  idea: "Idea",
  research: "Research",
  draft: "Draft",
  fact_check: "Fact-check",
  review: "Review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  repurpose: "Repurpose",
  skipped: "Skipped",
};

export const CONTENT_PILLAR_LABELS: Record<ContentPillarKey, string> = {
  proof_case_study: "Case studies & proof",
  operator_lesson: "Operator / delivery lessons",
  opinion_take: "Industry commentary",
  soft_cta: "Soft CTA / offer",
  personal_journey: "Founder journey",
  product_education: "Product education",
  culture: "Company culture",
};

export const CONTENT_CTA_LABELS: Record<ContentCtaType, string> = {
  book_fit_check: "Book a Fit Check",
  reply_with_niche: "Reply with niche",
  soft_dm: "Soft DM",
  share_lesson: "Share the lesson",
  book_demo: "Book a demo",
  start_trial: "Start trial",
  none: "No CTA",
};

/** @deprecated Prefer CONTENT_OUTCOME_LABELS */
export const CONTENT_GOAL_LABELS = CONTENT_OUTCOME_LABELS;

/** Open statuses that can become overdue. */
export const CONTENT_OPEN_STATUSES: ContentItemStatus[] = [
  "idea",
  "research",
  "draft",
  "fact_check",
  "review",
  "approved",
  "scheduled",
];

export const CONTENT_DONE_STATUSES: ContentItemStatus[] = ["published", "skipped", "repurpose"];

export function isContentItemOverdue(item: ContentItem, now = new Date()): boolean {
  if (!CONTENT_OPEN_STATUSES.includes(item.status)) return false;
  const due = new Date(item.dueAt).getTime();
  return Number.isFinite(due) && due < now.getTime();
}

export function contentVariantCharLimit(platform: ContentPlatform): number {
  switch (platform) {
    case "x":
      return 280;
    case "linkedin":
      return 3000;
    case "instagram":
      return 2200;
    case "reddit":
      return 10_000;
    default:
      return 3000;
  }
}

/** Normalize legacy kind/goal values from older documents. */
export function normalizeBrandKind(raw: string | undefined): ContentBrandKind {
  if (raw === "personal") return "founder";
  if (
    raw === "company" ||
    raw === "founder" ||
    raw === "product" ||
    raw === "employee" ||
    raw === "community"
  ) {
    return raw;
  }
  return "company";
}

export function normalizePrimaryOutcome(raw: string | undefined): ContentPrimaryOutcome {
  switch (raw) {
    case "authority_pipeline":
    case "authority_inbound":
      return "authority_inbound";
    case "personal_brand":
      return "authority_inbound";
    case "hiring":
    case "recruitment":
      return "recruitment";
    case "thought_leadership":
      return "authority_inbound";
    case "business_opportunities":
    case "partnerships":
    case "customer_education":
    case "community_growth":
    case "product_awareness":
      return raw;
    default:
      return "authority_inbound";
  }
}

export function normalizeContentStrategy(
  raw: string | undefined,
  kind: ContentBrandKind,
): ContentStrategyStyle {
  if (
    raw === "thought_leadership" ||
    raw === "build_in_public" ||
    raw === "case_studies" ||
    raw === "educational" ||
    raw === "founder_journey" ||
    raw === "company_culture" ||
    raw === "industry_commentary"
  ) {
    return raw;
  }
  if (raw === "thought_leadership" || kind === "founder") return "founder_journey";
  if (kind === "product") return "educational";
  return "case_studies";
}

export function normalizeItemStatus(raw: string | undefined): ContentItemStatus {
  switch (raw) {
    case "planned":
      return "idea";
    case "ready":
      return "approved";
    case "posted":
      return "published";
    case "idea":
    case "research":
    case "draft":
    case "fact_check":
    case "review":
    case "approved":
    case "scheduled":
    case "published":
    case "repurpose":
    case "skipped":
      return raw;
    default:
      return "idea";
  }
}
