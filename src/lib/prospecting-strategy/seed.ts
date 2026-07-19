import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";
import type {
  BuyerPersona,
  ProspectingStrategy,
  QualityChecklistItem,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";
import { emptyFirmographics } from "@/lib/prospecting-strategy/types";

function checklist(
  items: Array<{ fieldKey: string; label: string; requirement: QualityChecklistItem["requirement"] }>,
): QualityChecklistItem[] {
  return items.map((item, i) => ({
    id: `qc-${item.fieldKey}`,
    fieldKey: item.fieldKey,
    label: item.label,
    requirement: item.requirement,
    sortOrder: i,
  }));
}

const DEFAULT_CHECKLIST = checklist([
  { fieldKey: "companyName", label: "Company name", requirement: "required" },
  { fieldKey: "companyWebsite", label: "Company website", requirement: "required" },
  { fieldKey: "contactName", label: "Contact full name", requirement: "required" },
  { fieldKey: "jobTitle", label: "Job title matches persona", requirement: "required" },
  { fieldKey: "intentSignal", label: "At least one recent intent signal", requirement: "required" },
  { fieldKey: "signalEvidence", label: "Intent evidence URL + explanation", requirement: "required" },
  { fieldKey: "verifiedEmail", label: "Verified email", requirement: "optional" },
  { fieldKey: "personalizationNote", label: "Company-specific personalization note", requirement: "optional" },
]);

/** Stable demo/seed persona ids. */
export const SEED_PERSONA_IDS = {
  cto: "bp-cto-vp-eng",
  cio: "bp-cio-it",
  coo: "bp-coo-ops",
  supply: "bp-supply-chain",
  digital: "bp-digital-xform",
} as const;

export const SEED_STRATEGY_ID = "ps-stellix-master";

export function buildSeedPersonas(organizationId: string, createdBy: string): BuyerPersona[] {
  const now = new Date().toISOString();
  const base = { organizationId, createdBy, createdAt: now, updatedAt: now, active: true as const };

  return [
    {
      ...base,
      id: SEED_PERSONA_IDS.cto,
      name: "CTO / VP Engineering",
      description: "Technical leaders owning delivery, stack, and engineering capacity.",
      department: "Engineering",
      seniority: "C-level / VP / Director",
      titles: [
        { title: "CTO", kind: "approved" },
        { title: "Chief Technology Officer", kind: "approved" },
        { title: "VP Engineering", kind: "approved" },
        { title: "Vice President of Engineering", kind: "approved" },
        { title: "Director of Engineering", kind: "approved" },
        { title: "Head of Engineering", kind: "approved" },
        { title: "Head of Software", kind: "similar" },
        { title: "Software Development Director", kind: "similar" },
      ],
      industries: [],
      countries: [],
      responsibilities: ["Engineering delivery", "Technical architecture", "Team scaling"],
      businessGoals: ["Reduce technical debt", "Ship faster", "Scale reliably"],
      painPoints: [
        "Technical debt",
        "Slow delivery",
        "Legacy systems",
        "Developer shortages",
        "Scaling problems",
        "Integration complexity",
      ],
      buyingTriggers: ["Legacy rewrite", "Team augmentation RFP", "Cloud migration"],
      objections: ["We have an internal team", "Budget locked this quarter"],
      relevantServices: [
        "Legacy modernization",
        "Enterprise applications",
        "Dedicated teams",
        "Cloud and DevOps",
        "AI integration",
        "SaaS development",
      ],
      relevantSignalIds: [
        "stellix_legacy_ms_stack",
        "stellix_legacy_initiative",
        "stellix_cloud_migration",
        "stellix_devops",
        "stellix_ai",
      ],
      recommendedAngle: "Reduce maintenance risk and ship modern features without hiring freezes.",
      priority: 100,
    },
    {
      ...base,
      id: SEED_PERSONA_IDS.cio,
      name: "CIO / IT Director",
      description: "IT leaders owning enterprise apps, integrations, and compliance.",
      department: "IT",
      seniority: "C-level / VP / Director",
      titles: [
        { title: "CIO", kind: "approved" },
        { title: "Chief Information Officer", kind: "approved" },
        { title: "IT Director", kind: "approved" },
        { title: "Director of Information Technology", kind: "approved" },
        { title: "VP Information Technology", kind: "approved" },
        { title: "Head of Enterprise Applications", kind: "similar" },
        { title: "Head of Digital Transformation", kind: "similar" },
      ],
      industries: [],
      countries: [],
      responsibilities: ["Enterprise applications", "Integrations", "Security & compliance"],
      businessGoals: ["Modernize IT estate", "Improve reliability", "Reduce vendor sprawl"],
      painPoints: ["Aging systems", "Integration debt", "Audit pressure"],
      buyingTriggers: ["ERP/CRM upgrade", "Compliance mandate", "M&A integration"],
      objections: ["Preferred SI already selected"],
      relevantServices: [
        "Enterprise modernization",
        "ERP and CRM integrations",
        "Cloud migration",
        "Workflow automation",
      ],
      relevantSignalIds: [
        "stellix_erp_crm_portal",
        "stellix_integrations",
        "stellix_workflow_automation",
        "stellix_cloud_migration",
      ],
      recommendedAngle: "Unify systems and cut operational drag with reliable integrations.",
      priority: 90,
    },
    {
      ...base,
      id: SEED_PERSONA_IDS.coo,
      name: "COO / Operations Leader",
      description: "Operations leaders focused on throughput, visibility, and process.",
      department: "Operations",
      seniority: "C-level / VP / Director",
      titles: [
        { title: "COO", kind: "approved" },
        { title: "Chief Operating Officer", kind: "approved" },
        { title: "VP Operations", kind: "approved" },
        { title: "Director of Operations", kind: "approved" },
        { title: "Head of Operations", kind: "approved" },
        { title: "General Manager Operations", kind: "similar" },
      ],
      industries: [],
      countries: [],
      responsibilities: ["Operations excellence", "Process standardization", "Cross-team coordination"],
      businessGoals: ["Improve throughput", "Real-time visibility", "Lower manual work"],
      painPoints: ["Manual workflows", "Poor visibility", "Spreadsheet ops"],
      buyingTriggers: ["Ops digitization", "Dashboard initiative", "Process automation RFP"],
      objections: ["Change management risk"],
      relevantServices: [
        "Workflow automation",
        "Real-time dashboards",
        "Custom operations platforms",
        "Systems integration",
      ],
      relevantSignalIds: ["stellix_workflow_automation", "stellix_visibility_pain", "stellix_manual_pain"],
      recommendedAngle: "Replace manual ops with automated workflows and live dashboards.",
      priority: 80,
    },
    {
      ...base,
      id: SEED_PERSONA_IDS.supply,
      name: "Supply Chain & Logistics Leader",
      description: "Leaders owning warehousing, inventory, and logistics platforms.",
      department: "Supply Chain",
      seniority: "VP / Director",
      titles: [
        { title: "VP Supply Chain", kind: "approved" },
        { title: "Supply Chain Director", kind: "approved" },
        { title: "Logistics Director", kind: "approved" },
        { title: "Warehouse Director", kind: "approved" },
        { title: "Distribution Director", kind: "approved" },
        { title: "Head of Logistics", kind: "similar" },
        { title: "Head of Warehousing", kind: "similar" },
        { title: "Inventory Director", kind: "similar" },
      ],
      industries: ["Logistics", "Warehousing", "Manufacturing", "Distribution"],
      countries: [],
      responsibilities: ["Inventory accuracy", "Warehouse ops", "Dispatch & tracking"],
      businessGoals: ["End-to-end visibility", "Faster fulfillment", "Asset tracking"],
      painPoints: ["Blind inventory", "Paper processes", "RFID/IoT gaps"],
      buyingTriggers: ["WMS upgrade", "RFID rollout", "Yard/dispatch automation"],
      objections: ["Hardware budget", "Plant downtime"],
      relevantServices: [
        "RFID",
        "IoT",
        "Asset tracking",
        "Warehouse digitization",
        "Logistics platforms",
      ],
      relevantSignalIds: ["stellix_rfid", "stellix_iot", "stellix_logistics"],
      recommendedAngle: "Digitize warehouse and logistics with RFID/IoT and live tracking.",
      priority: 85,
    },
    {
      ...base,
      id: SEED_PERSONA_IDS.digital,
      name: "Digital Transformation & Innovation Leader",
      description: "Leaders driving AI, automation, and platform modernization.",
      department: "Innovation",
      seniority: "C-level / VP / Director",
      titles: [
        { title: "Chief Digital Officer", kind: "approved" },
        { title: "VP Digital Transformation", kind: "approved" },
        { title: "Director of Transformation", kind: "approved" },
        { title: "Head of Innovation", kind: "approved" },
        { title: "Digital Transformation Director", kind: "similar" },
        { title: "Head of Automation", kind: "similar" },
      ],
      industries: [],
      countries: [],
      responsibilities: ["Innovation portfolio", "Automation roadmap", "Platform strategy"],
      businessGoals: ["AI adoption", "Process automation", "Digital platforms"],
      painPoints: ["Pilot fatigue", "Integration blockers", "Talent gaps"],
      buyingTriggers: ["AI initiative", "Automation RFP", "Platform build"],
      objections: ["Need quick ROI proof"],
      relevantServices: ["AI", "Automation", "IoT", "Application modernization", "Digital platforms"],
      relevantSignalIds: ["stellix_ai", "stellix_workflow_automation", "stellix_enterprise_software"],
      recommendedAngle: "Move from pilots to production AI and automation with a capable build partner.",
      priority: 75,
    },
  ];
}

export function buildSeedStrategy(organizationId: string, ownerId: string): ProspectingStrategy {
  const now = new Date().toISOString();
  return {
    id: SEED_STRATEGY_ID,
    organizationId,
    name: "Stellix Soft Master Prospecting Strategy",
    description: "Default prospecting guidance for enterprise software, modernization, RFID/IoT, and AI.",
    objective:
      "Find high-quality companies and decision-makers with recent, verifiable intent for Stellix Soft services.",
    ownerId,
    status: "published",
    priority: 100,
    personaIds: Object.values(SEED_PERSONA_IDS),
    firmographics: {
      ...emptyFirmographics(),
      targetIndustries: [
        "Software",
        "Manufacturing",
        "Logistics",
        "Healthcare",
        "Financial Services",
      ],
      companySizeMin: "51-200",
      companyExamples: "Mid-market manufacturers, logistics operators, SaaS companies modernizing .NET estates.",
      disqualifiedExamples: "Solo freelancers, agencies reselling staff aug with no product ownership.",
    },
    linkedSignals: [
      {
        signalId: "stellix_legacy_ms_stack",
        enabled: true,
        priority: 100,
        recencyDays: 90,
        required: true,
        instructions: "Confirm legacy Microsoft stack via jobs, tech pages, or profiles.",
      },
      {
        signalId: "stellix_rfid",
        enabled: true,
        priority: 90,
        recencyDays: 90,
        required: false,
        instructions: "Look for RFID/asset-tracking initiatives in news or jobs.",
      },
      {
        signalId: "stellix_iot",
        enabled: true,
        priority: 88,
        recencyDays: 90,
        required: false,
      },
      {
        signalId: "stellix_ai",
        enabled: true,
        priority: 85,
        recencyDays: 90,
        required: false,
      },
      {
        signalId: "stellix_cloud_migration",
        enabled: true,
        priority: 80,
        recencyDays: 120,
        required: false,
      },
      {
        signalId: "stellix_workflow_automation",
        enabled: true,
        priority: 75,
        recencyDays: 90,
        required: false,
      },
    ],
    qualityChecklist: DEFAULT_CHECKLIST,
    sopMarkdown: `## Daily process
1. Open **My Strategy** and confirm today's allocation split.
2. Research companies matching firmographics and personas.
3. Capture at least one recent intent signal with evidence URL.
4. Enter the prospect and complete the quality checklist.
5. Push outreach-ready prospects to the assigned channel owner.

## Qualification
- Decision-maker title matches an approved persona
- Intent signal within recency window with evidence
- Company inside target industries / size band
- Not a duplicate or existing client

## Common mistakes
- Keyword-only matches with no evidence
- Personal emails counted as verified work email
- Old job posts treated as current buying intent
`,
    researchNotes:
      "Prefer LinkedIn, careers pages, company news, Crunchbase, and technology lookups. Attach evidence URLs.",
    dailyTargetDefault: 150,
    version: 1,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
}

/** In-memory demo dataset (no Firestore writes). */
export function buildDemoProspectingData(currentUserId: string): {
  personas: BuyerPersona[];
  strategies: ProspectingStrategy[];
  assignments: StrategyAssignment[];
} {
  const orgId = DEMO_WORKSPACE_ORG_ID;
  const personas = buildSeedPersonas(orgId, currentUserId);
  const strategy = buildSeedStrategy(orgId, currentUserId);
  const now = new Date().toISOString();
  const assignments: StrategyAssignment[] = [
    {
      id: "sa-demo-primary",
      organizationId: orgId,
      strategyId: strategy.id,
      userId: currentUserId,
      assignmentType: "primary",
      priority: 100,
      allocationPct: 100,
      status: "active",
      assignedBy: currentUserId,
      createdAt: now,
      updatedAt: now,
    },
  ];
  return {
    personas,
    strategies: [strategy],
    assignments,
  };
}

export { DEFAULT_CHECKLIST };
