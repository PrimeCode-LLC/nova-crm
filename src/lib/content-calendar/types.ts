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

/** Brand-level people slots (who does what for this brand). */
export type ContentResponsibilityKey =
  | "planner"
  | "writer"
  | "designer"
  | "poster"
  | "capturer"
  | "approver";

/** Parallel work steps on a content item. */
export type ContentChecklistStepKey = "write" | "graphics" | "approve" | "publish";

export type ContentChecklistStepStatus = "pending" | "done" | "skipped";

export type ContentChecklistStep = {
  key: ContentChecklistStepKey;
  status: ContentChecklistStepStatus;
  assigneeUserId: string;
  dueAt?: string;
  completedAt?: string;
  completedById?: string;
};

export type ContentAssetLink = {
  url: string;
  label?: string;
  addedById: string;
  addedAt: string;
};

export interface ContentCadence {
  /** Target posts per week per platform. */
  postsPerWeek: Partial<Record<ContentPlatform, number>>;
  /** 0=Sun … 6=Sat preferred publish weekdays. */
  preferredWeekdays: number[];
  /** Overall weekly publishing target across platforms. */
  weeklyPublishTarget?: number;
}

/** Fields that brand capture policy can require on each capture. */
export type ContentCaptureRequiredField =
  | "problem"
  | "solution"
  | "outcome"
  | "notes";

/**
 * Brand-level rules for continuous proof capture.
 * Distinct from checklist “Write copy” (post drafting).
 */
export interface ContentCapturePolicy {
  /** Target captures in a rolling 7-day window. 0 = no weekly target. */
  capturesPerWeek: number;
  /** Days without a capture before the capturer is considered idle. */
  idleDays: number;
  /** Fields that must be filled on submit (problem + solution always enforced). */
  requiredFields: ContentCaptureRequiredField[];
  /** In-app daily reminders when idle or behind cadence. */
  remindersEnabled: boolean;
  /** Free-text guidance shown to the capturer (what proof to feed). */
  requirementsNotes?: string;
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
  /** @deprecated Use primaryOutcome - kept for older docs via map-docs. */
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
  /** People responsible for each content ops slot (empty = fall back to owner). */
  responsibilities?: Partial<Record<ContentResponsibilityKey, string>>;
  /** How often / what the capturer must feed into Capture. */
  capturePolicy?: ContentCapturePolicy;
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
  /** Parallel checklist; when present, drives dashboard “my content” work. */
  checklist?: ContentChecklistStep[];
  /** Short designer brief (size, overlay text, focal idea, tone). */
  designInstructions?: string;
  /** Designer-pasted asset URLs (Drive, Figma, etc.). */
  assetLinks?: ContentAssetLink[];
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

export const CONTENT_RESPONSIBILITY_LABELS: Record<ContentResponsibilityKey, string> = {
  planner: "Planner",
  writer: "Writer",
  designer: "Designer",
  poster: "Poster",
  capturer: "Capturer",
  approver: "Approver",
};

export const CONTENT_CHECKLIST_STEP_LABELS: Record<ContentChecklistStepKey, string> = {
  write: "Write copy",
  graphics: "Add graphics",
  approve: "Approve",
  publish: "Publish",
};

export const CONTENT_RESPONSIBILITY_KEYS = Object.keys(
  CONTENT_RESPONSIBILITY_LABELS,
) as ContentResponsibilityKey[];

/** Formats that need a graphics checklist step. */
export const CONTENT_GRAPHICS_FORMATS: ContentFormat[] = [
  "graphic_post",
  "carousel",
  "short_video",
];

export function formatNeedsGraphics(format: ContentFormat | undefined): boolean {
  return Boolean(format && CONTENT_GRAPHICS_FORMATS.includes(format));
}

/** Recommended canvas size for designers (platform + format). */
export function contentGraphicsSizeHint(
  platform: ContentPlatform,
  format: ContentFormat | undefined,
): string {
  if (format === "carousel") {
    if (platform === "instagram") return "1080×1350 (portrait carousel slides)";
    if (platform === "linkedin") return "1080×1080 (carousel slides)";
    return "1080×1080 (carousel slides)";
  }
  if (format === "short_video") {
    if (platform === "instagram" || platform === "linkedin") return "1080×1920 (9:16 vertical)";
    if (platform === "x") return "1280×720 or 1080×1920";
    return "1080×1920 (9:16 vertical)";
  }
  // graphic_post and fallback
  if (platform === "instagram") return "1080×1080 (square) or 1080×1350 (portrait)";
  if (platform === "linkedin") return "1200×627 (landscape) or 1080×1080 (square)";
  if (platform === "x") return "1600×900 (16:9) or 1080×1080 (square)";
  if (platform === "reddit") return "1200×628 (link preview) or 1080×1080";
  return "1080×1080";
}

/** Resolve brand slot → userId, falling back to brand owner. */
export function resolveBrandResponsibility(
  brand: Pick<ContentBrand, "ownerUserId" | "defaultOwnerUserId" | "responsibilities">,
  key: ContentResponsibilityKey,
): string {
  const fromSlot = brand.responsibilities?.[key]?.trim();
  if (fromSlot) return fromSlot;
  const owner = brand.ownerUserId?.trim() || brand.defaultOwnerUserId?.trim();
  return owner || "";
}

export function firstPendingChecklistAssignee(
  checklist: ContentChecklistStep[] | undefined,
  fallbackUserId: string,
): string {
  const pending = checklist?.find((s) => s.status === "pending");
  return pending?.assigneeUserId?.trim() || fallbackUserId;
}

export function buildContentChecklist(input: {
  brand: Pick<
    ContentBrand,
    "ownerUserId" | "defaultOwnerUserId" | "responsibilities" | "approvalRequired"
  >;
  format?: ContentFormat;
  dueAt: string;
  fallbackUserId: string;
}): ContentChecklistStep[] {
  const { brand, format, dueAt, fallbackUserId } = input;
  const resolve = (key: ContentResponsibilityKey) =>
    resolveBrandResponsibility(brand, key) || fallbackUserId;

  const steps: ContentChecklistStep[] = [
    {
      key: "write",
      status: "pending",
      assigneeUserId: resolve("writer"),
      dueAt,
    },
  ];

  if (formatNeedsGraphics(format)) {
    steps.push({
      key: "graphics",
      status: "pending",
      assigneeUserId: resolve("designer"),
      dueAt,
    });
  }

  if (brand.approvalRequired) {
    steps.push({
      key: "approve",
      status: "pending",
      assigneeUserId: resolve("approver"),
      dueAt,
    });
  }

  steps.push({
    key: "publish",
    status: "pending",
    assigneeUserId: resolve("poster"),
    dueAt,
  });

  return steps;
}

/** Derive a sensible item status after checklist mutations. */
export function statusFromChecklist(
  checklist: ContentChecklistStep[],
  current: ContentItemStatus,
): ContentItemStatus {
  if (CONTENT_DONE_STATUSES.includes(current)) return current;
  const pending = checklist.filter((s) => s.status === "pending");
  if (pending.length === 0) {
    const publish = checklist.find((s) => s.key === "publish");
    if (publish?.status === "done") return "published";
    return "approved";
  }
  if (pending.some((s) => s.key === "approve")) return "review";
  if (pending.some((s) => s.key === "write" || s.key === "graphics")) return "draft";
  if (pending.some((s) => s.key === "publish")) return "scheduled";
  return current;
}

export function isChecklistStepOpen(step: ContentChecklistStep): boolean {
  return step.status === "pending";
}

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
