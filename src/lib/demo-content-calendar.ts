import { buildBrandDefaultsFromPack } from "@/lib/content-calendar/strategy-packs";
import type {
  ContentBrand,
  ContentCapture,
  ContentItem,
  ContentPlan,
} from "@/lib/content-calendar/types";
import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";

/** Demo content persona id (must match mockUsers). */
export const DEMO_CONTENT_USER_ID = "u-content-01";

function isoDaysFromNow(d: number): string {
  const date = new Date();
  date.setDate(date.getDate() + d);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
}

function isoDaysAgo(d: number): string {
  const date = new Date();
  date.setDate(date.getDate() - d);
  return date.toISOString();
}

/**
 * Sample brands / items / captures for demo mode.
 * Scoped so the content_team persona sees a real calendar plate without sales CRM data.
 */
export function buildDemoContentCalendar(contentUserId = DEMO_CONTENT_USER_ID): {
  brands: ContentBrand[];
  items: ContentItem[];
  captures: ContentCapture[];
  plans: ContentPlan[];
} {
  const org = DEMO_WORKSPACE_ORG_ID;
  const now = new Date().toISOString();
  const companyDefaults = buildBrandDefaultsFromPack({
    kind: "company",
    name: "Nova Agency",
  });
  const founderDefaults = buildBrandDefaultsFromPack({
    kind: "founder",
    name: "James Mitchell",
  });

  const brands: ContentBrand[] = [
    {
      id: "cbrand-demo-nova",
      organizationId: org,
      name: "Nova Agency",
      kind: "company",
      ...companyDefaults,
      goal: companyDefaults.primaryOutcome,
      proofSources: "Closed deals, client wins, delivery retrospectives",
      preferredCtas: "Book a fit check",
      knowledgeLibraryIds: [],
      ownerUserId: contentUserId,
      defaultOwnerUserId: contentUserId,
      responsibilities: {
        planner: contentUserId,
        writer: contentUserId,
        designer: contentUserId,
        poster: contentUserId,
        capturer: contentUserId,
        approver: "u-director",
      },
      capturePolicy: {
        capturesPerWeek: 3,
        idleDays: 7,
        requiredFields: ["problem", "solution", "outcome"],
        remindersEnabled: true,
        requirementsNotes: "Win stories and delivery lessons from outbound clients.",
      },
      active: true,
      createdAt: isoDaysAgo(60),
      updatedAt: now,
    },
    {
      id: "cbrand-demo-founder",
      organizationId: org,
      name: "James Mitchell",
      kind: "founder",
      ...founderDefaults,
      goal: founderDefaults.primaryOutcome,
      proofSources: "Founder notes, sales calls, hiring lessons",
      preferredCtas: "Reply with niche",
      knowledgeLibraryIds: [],
      ownerUserId: "u-director",
      defaultOwnerUserId: "u-director",
      responsibilities: {
        planner: contentUserId,
        writer: contentUserId,
        designer: contentUserId,
        poster: contentUserId,
        capturer: "u-director",
        approver: "u-director",
      },
      capturePolicy: {
        capturesPerWeek: 2,
        idleDays: 7,
        requiredFields: ["problem", "solution"],
        remindersEnabled: true,
      },
      active: true,
      createdAt: isoDaysAgo(45),
      updatedAt: now,
    },
  ];

  const items: ContentItem[] = [
    {
      id: "citem-demo-1",
      organizationId: org,
      brandId: "cbrand-demo-nova",
      pillarKey: "proof_case_study",
      publishAt: isoDaysFromNow(1),
      dueAt: isoDaysFromNow(-1),
      status: "draft",
      title: "How we cut reply lag from 3 days to 4 hours",
      angle: "Ops case study from a SaaS outbound pod",
      format: "carousel",
      platforms: ["linkedin"],
      variants: [
        {
          platform: "linkedin",
          body: "Most outbound teams lose deals in the reply gap…",
          hook: "We tracked every reply for 30 days.",
          format: "carousel",
        },
      ],
      ctaType: "book_fit_check",
      assigneeUserId: contentUserId,
      ownerUserId: contentUserId,
      checklist: [
        {
          key: "write",
          status: "done",
          assigneeUserId: contentUserId,
          dueAt: isoDaysFromNow(-3),
          completedAt: isoDaysAgo(2),
          completedById: contentUserId,
        },
        {
          key: "graphics",
          status: "pending",
          assigneeUserId: contentUserId,
          dueAt: isoDaysFromNow(-1),
        },
        {
          key: "approve",
          status: "pending",
          assigneeUserId: "u-director",
          dueAt: isoDaysFromNow(0),
        },
        {
          key: "publish",
          status: "pending",
          assigneeUserId: contentUserId,
          dueAt: isoDaysFromNow(1),
        },
      ],
      designInstructions: "6-slide carousel, dark zinc, one metric per slide.",
      createdAt: isoDaysAgo(5),
      updatedAt: now,
    },
    {
      id: "citem-demo-2",
      organizationId: org,
      brandId: "cbrand-demo-founder",
      pillarKey: "operator_lesson",
      publishAt: isoDaysFromNow(2),
      dueAt: isoDaysFromNow(0),
      status: "research",
      title: "Why we stopped scoring leads on gut feel",
      angle: "Founder lesson on BANT + fit-check discipline",
      format: "text_post",
      platforms: ["linkedin", "x"],
      variants: [
        {
          platform: "linkedin",
          body: "Gut-feel scoring felt fast until pipeline stalled…",
          hook: "We replaced vibes with a fit check.",
        },
      ],
      ctaType: "reply_with_niche",
      assigneeUserId: contentUserId,
      ownerUserId: contentUserId,
      checklist: [
        {
          key: "write",
          status: "pending",
          assigneeUserId: contentUserId,
          dueAt: isoDaysFromNow(0),
        },
        {
          key: "graphics",
          status: "pending",
          assigneeUserId: contentUserId,
          dueAt: isoDaysFromNow(1),
        },
        {
          key: "approve",
          status: "pending",
          assigneeUserId: "u-director",
          dueAt: isoDaysFromNow(2),
        },
        {
          key: "publish",
          status: "pending",
          assigneeUserId: contentUserId,
          dueAt: isoDaysFromNow(2),
        },
      ],
      createdAt: isoDaysAgo(3),
      updatedAt: now,
    },
    {
      id: "citem-demo-3",
      organizationId: org,
      brandId: "cbrand-demo-nova",
      pillarKey: "soft_cta",
      publishAt: isoDaysFromNow(4),
      dueAt: isoDaysFromNow(3),
      status: "scheduled",
      title: "Book a 15-min fit check this week",
      angle: "Soft CTA for agencies stuck on cold reply rates",
      format: "graphic_post",
      platforms: ["linkedin", "instagram"],
      variants: [
        {
          platform: "linkedin",
          body: "If replies are stuck under 2%, we should talk.",
          format: "graphic_post",
        },
      ],
      ctaType: "book_fit_check",
      assigneeUserId: contentUserId,
      ownerUserId: contentUserId,
      checklist: [
        {
          key: "write",
          status: "done",
          assigneeUserId: contentUserId,
          completedAt: isoDaysAgo(1),
          completedById: contentUserId,
        },
        {
          key: "graphics",
          status: "done",
          assigneeUserId: contentUserId,
          completedAt: isoDaysAgo(1),
          completedById: contentUserId,
        },
        {
          key: "approve",
          status: "done",
          assigneeUserId: "u-director",
          completedAt: isoDaysAgo(0),
          completedById: "u-director",
        },
        {
          key: "publish",
          status: "pending",
          assigneeUserId: contentUserId,
          dueAt: isoDaysFromNow(4),
        },
      ],
      createdAt: isoDaysAgo(8),
      updatedAt: now,
    },
    {
      id: "citem-demo-4",
      organizationId: org,
      brandId: "cbrand-demo-nova",
      pillarKey: "opinion_take",
      publishAt: isoDaysFromNow(-2),
      dueAt: isoDaysFromNow(-3),
      status: "published",
      title: "Sequences without a content plate still stall",
      angle: "Opinion take tying CRM ops to content proof",
      format: "text_post",
      platforms: ["linkedin"],
      variants: [{ platform: "linkedin", body: "Published sample post body." }],
      ctaType: "share_lesson",
      assigneeUserId: contentUserId,
      ownerUserId: contentUserId,
      completedAt: isoDaysAgo(2),
      createdAt: isoDaysAgo(12),
      updatedAt: isoDaysAgo(2),
    },
  ];

  const captures: ContentCapture[] = [
    {
      id: "ccap-demo-1",
      organizationId: org,
      brandId: "cbrand-demo-nova",
      libraryId: "lib-demo-ops",
      captureType: "win",
      problem: "SDR team waited days to reply to warm inbound",
      solution: "Shared inbox + SLA board with same-day ownership",
      outcome: "Median first response dropped to under 4 hours",
      publicSafe: true,
      status: "indexed",
      normalizedTitle: "Reply lag case study",
      queueForPosts: true,
      createdById: contentUserId,
      createdAt: isoDaysAgo(4),
      updatedAt: isoDaysAgo(4),
    },
    {
      id: "ccap-demo-2",
      organizationId: org,
      brandId: "cbrand-demo-founder",
      libraryId: "lib-demo-founder",
      captureType: "win",
      problem: "Hiring SDRs without a clear outbound playbook",
      solution: "Documented channel scripts + fit-check rubric before headcount",
      outcome: "Time-to-productivity improved on the next two hires",
      publicSafe: true,
      status: "normalized",
      createdById: "u-director",
      createdAt: isoDaysAgo(10),
      updatedAt: isoDaysAgo(9),
    },
  ];

  const plans: ContentPlan[] = [
    {
      id: "cplan-demo-1",
      organizationId: org,
      brandId: "cbrand-demo-nova",
      startDate: isoDaysFromNow(0).slice(0, 10),
      endDate: isoDaysFromNow(6).slice(0, 10),
      dayCount: 7,
      platforms: ["linkedin", "instagram"],
      status: "approved",
      planSummary: "Proof + soft CTA week for Nova Agency LinkedIn.",
      slots: [
        {
          id: "cslot-1",
          publishAt: isoDaysFromNow(1),
          platform: "linkedin",
          pillarKey: "proof_case_study",
          title: "How we cut reply lag from 3 days to 4 hours",
          angle: "Ops case study",
          proofHint: "ccap-demo-1",
          ctaType: "book_fit_check",
          approved: true,
          contentItemId: "citem-demo-1",
        },
        {
          id: "cslot-2",
          publishAt: isoDaysFromNow(4),
          platform: "linkedin",
          pillarKey: "soft_cta",
          title: "Book a 15-min fit check this week",
          angle: "Soft CTA",
          proofHint: "",
          ctaType: "book_fit_check",
          approved: true,
          contentItemId: "citem-demo-3",
        },
      ],
      createdById: contentUserId,
      createdAt: isoDaysAgo(6),
      updatedAt: now,
    },
  ];

  return { brands, items, captures, plans };
}
