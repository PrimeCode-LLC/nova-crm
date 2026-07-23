import type {
  ContentBrand,
  ContentCapture,
  ContentItem,
  ContentPlan,
  ContentPlanSlot,
  ContentPlatform,
  ContentPillar,
  ContentPillarKey,
  ContentVariant,
  ContentRagCitation,
  ContentItemStatus,
  ContentBrandKind,
  ContentCtaType,
  ContentCadence,
  ContentCaptureStatus,
  ContentPlanStatus,
  ContentFormat,
  ContentPrimaryOutcome,
  ContentStrategyStyle,
  ContentResponsibilityKey,
  ContentChecklistStep,
  ContentChecklistStepKey,
  ContentChecklistStepStatus,
  ContentAssetLink,
} from "@/lib/content-calendar/types";
import {
  normalizeBrandKind,
  normalizeContentStrategy,
  normalizeItemStatus,
  normalizePrimaryOutcome,
} from "@/lib/content-calendar/types";

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function mapContentBrand(id: string, data: Record<string, unknown>): ContentBrand {
  const pillarsRaw = Array.isArray(data.pillars) ? data.pillars : [];
  const pillars: ContentPillar[] = pillarsRaw.map((p) => {
    const row = (p ?? {}) as Record<string, unknown>;
    return {
      key: str(row.key, "operator_lesson") as ContentPillarKey,
      name: str(row.name, "Pillar"),
      targetPercent: typeof row.targetPercent === "number" ? row.targetPercent : 0,
      allowedCtaTypes: strArr(row.allowedCtaTypes) as ContentCtaType[],
      enabled: bool(row.enabled, true),
    };
  });

  const cadenceRaw = (data.cadence ?? {}) as Record<string, unknown>;
  const postsPerWeekRaw = (cadenceRaw.postsPerWeek ?? {}) as Record<string, unknown>;
  const postsPerWeek: ContentCadence["postsPerWeek"] = {};
  for (const key of ["linkedin", "x", "instagram", "reddit"] as ContentPlatform[]) {
    const n = postsPerWeekRaw[key];
    if (typeof n === "number") postsPerWeek[key] = n;
  }

  const promptOverridesRaw = data.promptOverrides as Record<string, unknown> | undefined;
  const kind = normalizeBrandKind(str(data.kind, "company"));
  const primaryOutcome = normalizePrimaryOutcome(
    str(data.primaryOutcome) || str(data.goal, "authority_inbound"),
  );
  const contentStrategy = normalizeContentStrategy(str(data.contentStrategy) || undefined, kind);

  return {
    id,
    organizationId: str(data.organizationId),
    name: str(data.name, "Brand"),
    kind,
    goal: primaryOutcome,
    primaryOutcome,
    contentStrategy,
    strategyPackId: str(data.strategyPackId, "b2b_agency_v1"),
    platforms: strArr(data.platforms) as ContentPlatform[],
    positioning: str(data.positioning),
    voiceRules: str(data.voiceRules),
    bannedPhrases: strArr(data.bannedPhrases),
    targetAudience: str(data.targetAudience),
    offersToPromote: str(data.offersToPromote),
    topicsToAvoid: strArr(data.topicsToAvoid),
    referenceCreators: str(data.referenceCreators),
    proofSources: str(data.proofSources),
    preferredCtas: str(data.preferredCtas),
    defaultFormats: (strArr(data.defaultFormats) as ContentFormat[]).length
      ? (strArr(data.defaultFormats) as ContentFormat[])
      : ["text_post"],
    approvalRequired: bool(data.approvalRequired, kind === "company"),
    knowledgeLibraryIds: strArr(data.knowledgeLibraryIds),
    knowledgeDocumentIds: strArr(data.knowledgeDocumentIds),
    pillars,
    cadence: {
      postsPerWeek,
      preferredWeekdays: Array.isArray(cadenceRaw.preferredWeekdays)
        ? (cadenceRaw.preferredWeekdays as unknown[]).filter((n): n is number => typeof n === "number")
        : [1, 2, 3, 4],
      weeklyPublishTarget:
        typeof cadenceRaw.weeklyPublishTarget === "number"
          ? cadenceRaw.weeklyPublishTarget
          : undefined,
    },
    defaultCtaType: (str(data.defaultCtaType, "book_fit_check") as ContentCtaType) || "book_fit_check",
    promptOverrides: promptOverridesRaw
      ? { extraSystemInstructions: str(promptOverridesRaw.extraSystemInstructions) || undefined }
      : undefined,
    ownerUserId: str(data.ownerUserId),
    defaultOwnerUserId: str(data.defaultOwnerUserId) || undefined,
    responsibilities: mapResponsibilities(data.responsibilities),
    active: bool(data.active, true),
    createdAt: str(data.createdAt),
    updatedAt: str(data.updatedAt),
  };
}

function mapResponsibilities(
  raw: unknown,
): Partial<Record<ContentResponsibilityKey, string>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const keys: ContentResponsibilityKey[] = [
    "planner",
    "writer",
    "designer",
    "poster",
    "capturer",
    "approver",
  ];
  const out: Partial<Record<ContentResponsibilityKey, string>> = {};
  let any = false;
  for (const key of keys) {
    const v = str(o[key]).trim();
    if (v) {
      out[key] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

export function mapContentItem(id: string, data: Record<string, unknown>): ContentItem {
  const variantsRaw = Array.isArray(data.variants) ? data.variants : [];
  const variants: ContentVariant[] = variantsRaw.map((v) => {
    const row = (v ?? {}) as Record<string, unknown>;
    return {
      platform: str(row.platform, "linkedin") as ContentPlatform,
      body: str(row.body),
      hook: str(row.hook) || undefined,
      format: (str(row.format) as ContentFormat) || undefined,
    };
  });

  const citationsRaw = Array.isArray(data.ragCitations) ? data.ragCitations : [];
  const ragCitations: ContentRagCitation[] = citationsRaw.map((c) => {
    const row = (c ?? {}) as Record<string, unknown>;
    return {
      title: str(row.title),
      excerpt: str(row.excerpt),
      documentId: str(row.documentId) || undefined,
      libraryId: str(row.libraryId) || undefined,
    };
  });

  const status = normalizeItemStatus(str(data.status, "idea"));

  return {
    id,
    organizationId: str(data.organizationId),
    brandId: str(data.brandId),
    pillarKey: str(data.pillarKey, "operator_lesson") as ContentPillarKey,
    publishAt: str(data.publishAt),
    dueAt: str(data.dueAt || data.publishAt),
    status,
    title: str(data.title),
    angle: str(data.angle),
    rationale: str(data.rationale) || undefined,
    format: (str(data.format) as ContentFormat) || undefined,
    platforms: strArr(data.platforms) as ContentPlatform[],
    variants,
    ctaType: str(data.ctaType, "none") as ContentCtaType,
    ragCitations: ragCitations.length ? ragCitations : undefined,
    verifiedFromKnowledge:
      typeof data.verifiedFromKnowledge === "boolean"
        ? data.verifiedFromKnowledge
        : ragCitations.length > 0,
    blockerNote: str(data.blockerNote) || undefined,
    assigneeUserId: str(data.assigneeUserId),
    ownerUserId: str(data.ownerUserId),
    checklist: mapChecklist(data.checklist),
    assetLinks: mapAssetLinks(data.assetLinks),
    planId: str(data.planId) || undefined,
    captureId: str(data.captureId) || undefined,
    completedAt: str(data.completedAt) || undefined,
    createdAt: str(data.createdAt),
    updatedAt: str(data.updatedAt),
  };
}

function mapChecklist(raw: unknown): ContentChecklistStep[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const steps: ContentChecklistStep[] = [];
  for (const row of raw) {
    const r = (row ?? {}) as Record<string, unknown>;
    const key = str(r.key) as ContentChecklistStepKey;
    if (key !== "write" && key !== "graphics" && key !== "approve" && key !== "publish") continue;
    const statusRaw = str(r.status, "pending") as ContentChecklistStepStatus;
    const status: ContentChecklistStepStatus =
      statusRaw === "done" || statusRaw === "skipped" ? statusRaw : "pending";
    steps.push({
      key,
      status,
      assigneeUserId: str(r.assigneeUserId),
      dueAt: str(r.dueAt) || undefined,
      completedAt: str(r.completedAt) || undefined,
      completedById: str(r.completedById) || undefined,
    });
  }
  return steps.length ? steps : undefined;
}

function mapAssetLinks(raw: unknown): ContentAssetLink[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const links: ContentAssetLink[] = [];
  for (const row of raw) {
    const r = (row ?? {}) as Record<string, unknown>;
    const url = str(r.url).trim();
    if (!url) continue;
    links.push({
      url,
      label: str(r.label).trim() || undefined,
      addedById: str(r.addedById),
      addedAt: str(r.addedAt),
    });
  }
  return links.length ? links : undefined;
}

export function mapContentCapture(id: string, data: Record<string, unknown>): ContentCapture {
  return {
    id,
    organizationId: str(data.organizationId),
    brandId: str(data.brandId) || undefined,
    problem: str(data.problem),
    solution: str(data.solution),
    outcome: str(data.outcome) || undefined,
    notes: str(data.notes) || undefined,
    publicSafe: bool(data.publicSafe, true),
    status: str(data.status, "draft") as ContentCaptureStatus,
    normalizedTitle: str(data.normalizedTitle) || undefined,
    normalizedMarkdown: str(data.normalizedMarkdown) || undefined,
    knowledgeDocumentId: str(data.knowledgeDocumentId) || undefined,
    libraryId: str(data.libraryId) || undefined,
    queueForPosts: bool(data.queueForPosts, false),
    createdById: str(data.createdById),
    createdAt: str(data.createdAt),
    updatedAt: str(data.updatedAt),
    errorMessage: str(data.errorMessage) || undefined,
  };
}

export function mapContentPlan(id: string, data: Record<string, unknown>): ContentPlan {
  const slotsRaw = Array.isArray(data.slots) ? data.slots : [];
  const slots: ContentPlanSlot[] = slotsRaw.map((s) => {
    const row = (s ?? {}) as Record<string, unknown>;
    return {
      id: str(row.id),
      publishAt: str(row.publishAt),
      platform: str(row.platform, "linkedin") as ContentPlatform,
      pillarKey: str(row.pillarKey, "operator_lesson") as ContentPillarKey,
      title: str(row.title),
      angle: str(row.angle),
      proofHint: str(row.proofHint),
      ctaType: str(row.ctaType, "none") as ContentCtaType,
      rationale: str(row.rationale) || undefined,
      format: (str(row.format) as ContentFormat) || undefined,
      targetAudienceHint: str(row.targetAudienceHint) || undefined,
      approved: bool(row.approved, false),
      contentItemId: str(row.contentItemId) || undefined,
    };
  });

  return {
    id,
    organizationId: str(data.organizationId),
    brandId: str(data.brandId),
    startDate: str(data.startDate),
    endDate: str(data.endDate),
    dayCount: typeof data.dayCount === "number" ? data.dayCount : 7,
    platforms: strArr(data.platforms) as ContentPlatform[],
    status: str(data.status, "draft") as ContentPlanStatus,
    planSummary: str(data.planSummary),
    slots,
    createdById: str(data.createdById),
    createdAt: str(data.createdAt),
    updatedAt: str(data.updatedAt),
  };
}

export type { ContentBrandKind, ContentPrimaryOutcome, ContentStrategyStyle, ContentItemStatus };
