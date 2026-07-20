import type { BuyerPersona, ProspectingStrategy } from "@/lib/prospecting-strategy/types";
import { emptyFirmographics } from "@/lib/prospecting-strategy/types";
import { DEFAULT_DAILY_TARGETS } from "@/lib/prospecting-strategy/qualify";

export const PERSON1_STRATEGY_ID = "ps-supply-chain-logistics";

export const PERSON1_PERSONA_IDS = {
  supplyExec: "bp-p1-supply-exec",
  logistics: "bp-p1-logistics",
  warehouse: "bp-p1-warehouse",
  ops: "bp-p1-ops",
  manufacturing: "bp-p1-mfg",
  technical: "bp-p1-technical",
} as const;

function checklist() {
  return [
    { id: "qc-company", fieldKey: "companyName", label: "Company name + website", requirement: "required" as const, sortOrder: 0 },
    { id: "qc-industry", fieldKey: "industry", label: "Approved industry", requirement: "required" as const, sortOrder: 1 },
    { id: "qc-size", fieldKey: "companySize", label: "Preferred size or confirmed project", requirement: "required" as const, sortOrder: 2 },
    { id: "qc-title", fieldKey: "jobTitle", label: "Approved persona title", requirement: "required" as const, sortOrder: 3 },
    { id: "qc-linkedin", fieldKey: "linkedin", label: "Contact LinkedIn profile", requirement: "required" as const, sortOrder: 4 },
    { id: "qc-email", fieldKey: "verifiedEmail", label: "Verified business email", requirement: "required" as const, sortOrder: 5 },
    { id: "qc-signal", fieldKey: "intentSignal", label: "Recent intent (1 strong or 2 medium)", requirement: "required" as const, sortOrder: 6 },
    { id: "qc-url", fieldKey: "signalEvidence", label: "Signal evidence URL + date + explanation", requirement: "required" as const, sortOrder: 7 },
    { id: "qc-opp", fieldKey: "opportunity", label: "Primary opportunity type", requirement: "required" as const, sortOrder: 8 },
    { id: "qc-pers", fieldKey: "personalizationNote", label: "Structured personalization note", requirement: "required" as const, sortOrder: 9 },
    { id: "qc-score", fieldKey: "qualityScore", label: "Quality score ≥ 45", requirement: "required" as const, sortOrder: 10 },
  ];
}

export function buildPerson1Personas(organizationId: string, createdBy: string): BuyerPersona[] {
  const now = new Date().toISOString();
  const base = {
    organizationId,
    createdBy,
    createdAt: now,
    updatedAt: now,
    active: true as const,
    countries: ["United States"],
    industries: [
      "Logistics",
      "Warehousing",
      "Manufacturing",
      "Distribution",
      "Supply chain",
    ],
  };

  return [
    {
      ...base,
      id: PERSON1_PERSONA_IDS.supplyExec,
      name: "Supply Chain Executive",
      description: "Operational buyer owning inventory flow, distribution performance, and supply-chain tech.",
      department: "Supply Chain",
      seniority: "C-level / VP / Director",
      titles: [
        { title: "Chief Supply Chain Officer", kind: "approved" },
        { title: "VP Supply Chain", kind: "approved" },
        { title: "Vice President of Supply Chain", kind: "approved" },
        { title: "Supply Chain Director", kind: "approved" },
        { title: "Director of Supply Chain", kind: "approved" },
        { title: "Head of Supply Chain", kind: "approved" },
        { title: "Supply Chain Operations Director", kind: "approved" },
        { title: "Global Supply Chain Director", kind: "approved" },
        { title: "Recruiter", kind: "excluded" },
        { title: "Marketing Director", kind: "excluded" },
        { title: "Sales Director", kind: "excluded" },
      ],
      responsibilities: [
        "Inventory flow",
        "Supplier and distribution performance",
        "Operational visibility",
        "Warehouse efficiency",
        "Supply-chain technology",
      ],
      businessGoals: ["Cost reduction", "Visibility", "Warehouse efficiency"],
      painPoints: ["Inventory inaccuracies", "Lack of visibility", "Fragmented systems"],
      buyingTriggers: ["RFID rollout", "New DC", "WMS replacement"],
      objections: ["Hardware budget", "Internal IT ownership"],
      relevantServices: [
        "RFID and asset tracking",
        "Inventory visibility",
        "Supply-chain dashboards",
        "ERP and WMS integrations",
        "Workflow automation",
      ],
      relevantSignalIds: ["stellix_rfid", "stellix_iot", "stellix_logistics", "stellix_visibility_pain"],
      recommendedAngle:
        "Supporting the software, integrations, and dashboards around supply-chain visibility initiatives.",
      priority: 100,
    },
    {
      ...base,
      id: PERSON1_PERSONA_IDS.logistics,
      name: "Logistics and Transportation Leader",
      description: "Leaders owning fleet, dispatch, shipment visibility, and last-mile operations.",
      department: "Logistics",
      seniority: "VP / Director",
      titles: [
        { title: "VP Logistics", kind: "approved" },
        { title: "Vice President of Logistics", kind: "approved" },
        { title: "Logistics Director", kind: "approved" },
        { title: "Director of Logistics", kind: "approved" },
        { title: "Head of Logistics", kind: "approved" },
        { title: "Transportation Director", kind: "approved" },
        { title: "Fleet Director", kind: "approved" },
        { title: "Distribution Director", kind: "approved" },
        { title: "Last Mile Operations Director", kind: "similar" },
      ],
      responsibilities: ["Dispatch", "Fleet performance", "Shipment visibility"],
      businessGoals: ["On-time delivery", "Route efficiency", "Driver productivity"],
      painPoints: ["Shipment visibility problems", "Manual dispatch"],
      buyingTriggers: ["Fleet expansion", "TMS implementation"],
      objections: [],
      relevantServices: [
        "Dispatch management",
        "Fleet tracking",
        "Driver mobile apps",
        "TMS integrations",
        "Real-time dashboards",
      ],
      relevantSignalIds: ["stellix_logistics", "stellix_iot", "stellix_mobile"],
      recommendedAngle:
        "Lead with dispatch, driver applications, route visibility and centralized operational reporting.",
      priority: 95,
    },
    {
      ...base,
      id: PERSON1_PERSONA_IDS.warehouse,
      name: "Warehouse and Inventory Leader",
      description: "Warehouse / DC / inventory owners. Manager titles only under ~500 employees.",
      department: "Warehouse",
      seniority: "Director / Senior Manager",
      titles: [
        { title: "Warehouse Director", kind: "approved" },
        { title: "Director of Warehouse Operations", kind: "approved" },
        { title: "Head of Warehousing", kind: "approved" },
        { title: "Distribution Center Director", kind: "approved" },
        { title: "Inventory Director", kind: "approved" },
        { title: "Director of Inventory Management", kind: "approved" },
        { title: "Fulfillment Director", kind: "approved" },
        { title: "Warehouse Operations Manager", kind: "similar" },
        { title: "Warehouse Associate", kind: "excluded" },
        { title: "Supervisor", kind: "excluded" },
      ],
      responsibilities: ["Inventory accuracy", "Warehouse ops", "Fulfillment"],
      businessGoals: ["Accuracy", "Throughput", "Labor efficiency"],
      painPoints: ["Manual inventory counts", "Lost assets"],
      buyingTriggers: ["RFID pilot", "WMS implementation", "New warehouse"],
      objections: [],
      relevantServices: [
        "RFID implementation",
        "Inventory tracking",
        "WMS integrations",
        "Mobile warehouse applications",
      ],
      relevantSignalIds: ["stellix_rfid", "stellix_iot", "stellix_visibility_pain"],
      recommendedAngle:
        "RFID, inventory tracking, WMS integrations and warehouse mobile apps for the facility.",
      priority: 90,
    },
    {
      ...base,
      id: PERSON1_PERSONA_IDS.ops,
      name: "Operations Executive",
      description: "COO / VP Ops owning process automation and operational platforms.",
      department: "Operations",
      seniority: "C-level / VP / Director",
      titles: [
        { title: "Chief Operating Officer", kind: "approved" },
        { title: "COO", kind: "approved" },
        { title: "VP Operations", kind: "approved" },
        { title: "Vice President of Operations", kind: "approved" },
        { title: "Director of Operations", kind: "approved" },
        { title: "Head of Operations", kind: "approved" },
        { title: "Operational Excellence Director", kind: "similar" },
      ],
      responsibilities: ["Process standardization", "Cross-team coordination"],
      businessGoals: ["Throughput", "Real-time visibility", "Lower manual work"],
      painPoints: ["Manual workflows", "Spreadsheet ops"],
      buyingTriggers: ["Ops digitization", "Automation program"],
      objections: ["Change management"],
      relevantServices: [
        "Process automation",
        "Custom operational platforms",
        "Real-time dashboards",
        "Systems integration",
      ],
      relevantSignalIds: ["stellix_workflow_automation", "stellix_manual_pain", "stellix_visibility_pain"],
      recommendedAngle: "Replace manual ops with automated workflows and live dashboards.",
      priority: 85,
    },
    {
      ...base,
      id: PERSON1_PERSONA_IDS.manufacturing,
      name: "Manufacturing Operations Leader",
      description: "Plant / production leaders with asset tracking and visibility needs.",
      department: "Manufacturing",
      seniority: "VP / Director",
      titles: [
        { title: "VP Manufacturing", kind: "approved" },
        { title: "Vice President of Manufacturing", kind: "approved" },
        { title: "Manufacturing Director", kind: "approved" },
        { title: "Director of Manufacturing", kind: "approved" },
        { title: "Plant Operations Director", kind: "approved" },
        { title: "Production Director", kind: "approved" },
        { title: "Head of Manufacturing", kind: "approved" },
        { title: "Industrial Automation Director", kind: "similar" },
      ],
      responsibilities: ["Production visibility", "Plant ops", "Asset tracking"],
      businessGoals: ["OEE", "Traceability", "Modernization"],
      painPoints: ["Manual counts", "Legacy plant software"],
      buyingTriggers: ["New plant", "RFID/IoT", "ERP integration"],
      objections: ["Plant downtime"],
      relevantServices: [
        "Production visibility",
        "RFID and IoT",
        "Manufacturing dashboards",
        "ERP integration",
        "Legacy manufacturing modernization",
      ],
      relevantSignalIds: ["stellix_rfid", "stellix_iot", "stellix_legacy_ms_stack"],
      recommendedAngle: "RFID/IoT, production dashboards and ERP integration for plant visibility.",
      priority: 88,
    },
    {
      ...base,
      id: PERSON1_PERSONA_IDS.technical,
      name: "Technical Buyer (secondary)",
      description:
        "IT/engineering buyer paired with an operational buyer — do not replace ops unless IT owns the project.",
      department: "IT",
      seniority: "C-level / VP / Director",
      titles: [
        { title: "CIO", kind: "approved" },
        { title: "Chief Information Officer", kind: "approved" },
        { title: "CTO", kind: "approved" },
        { title: "Chief Technology Officer", kind: "approved" },
        { title: "VP Information Technology", kind: "approved" },
        { title: "IT Director", kind: "approved" },
        { title: "Director of Enterprise Applications", kind: "approved" },
        { title: "Director of Business Systems", kind: "approved" },
        { title: "VP Engineering", kind: "similar" },
        { title: "Digital Transformation Director", kind: "similar" },
        { title: "Software Developer", kind: "excluded" },
      ],
      responsibilities: ["Enterprise apps", "Integrations", "Platform strategy"],
      businessGoals: ["System consolidation", "Reliable integrations"],
      painPoints: ["Integration debt", "Vendor sprawl"],
      buyingTriggers: ["ERP/WMS project", "Partner search"],
      objections: ["Preferred SI already selected"],
      relevantServices: [
        "API and system integrations",
        "Legacy migration",
        "Custom operational modules",
        "Reporting dashboards",
      ],
      relevantSignalIds: [
        "stellix_integrations",
        "stellix_erp_crm_portal",
        "stellix_cloud_migration",
        "stellix_partner_search",
      ],
      recommendedAngle:
        "Connect the new platform with existing operational systems and eliminate fragmented workflows.",
      priority: 70,
    },
  ];
}

export function buildPerson1Strategy(organizationId: string, ownerId: string): ProspectingStrategy {
  const now = new Date().toISOString();
  return {
    id: PERSON1_STRATEGY_ID,
    organizationId,
    name: "Supply Chain, Logistics, Warehousing and Manufacturing Prospecting",
    description:
      "Person 1 assignment — physical operations companies with recent RFID, warehouse, logistics, or visibility intent.",
    objective:
      "Identify companies with physical operations, inventory, warehouses, fleets or trackable assets that have a recent, verifiable need for RFID/IoT, warehouse/logistics software, integrations, dashboards, or modernization.",
    missionBlurb: `Your responsibility is to find companies with physical operations, inventory, warehouses, fleets or manufacturing facilities that show recent evidence of expansion, automation, RFID, software modernization, integration requirements or operational visibility problems.

Start with a business signal, validate the company, identify the correct operational or technical decision-maker, verify the email, attach the evidence and explain exactly how Stellix Soft can help.

Do not submit random contacts, old signals, generic job openings or companies that only match an industry keyword.

A qualified prospect must answer four questions:
1. Why this company?
2. Why this decision-maker?
3. Why now?
4. Which Stellix Soft service is relevant?`,
    ownerId,
    status: "published",
    priority: 100,
    personaIds: Object.values(PERSON1_PERSONA_IDS),
    firmographics: {
      ...emptyFirmographics(),
      targetIndustries: [
        "Logistics",
        "Transportation",
        "Third-party logistics",
        "Warehousing",
        "Distribution",
        "Supply chain",
        "Manufacturing",
        "Industrial manufacturing",
        "Automotive",
        "Food and beverage manufacturing",
        "Consumer goods",
        "Wholesale",
        "Retail operations",
        "Pharmaceutical",
        "Healthcare supply chain",
        "Medical devices",
        "Construction materials",
        "Oil and gas services",
        "Equipment rental",
        "Cold-chain logistics",
        "Freight and trucking",
        "Last-mile delivery",
      ],
      excludedIndustries: [
        "Marketing agencies",
        "Recruitment agencies",
        "Solo consultants",
        "Pure software companies",
      ],
      targetCountries: ["United States", "Canada", "United Kingdom", "United Arab Emirates", "Saudi Arabia"],
      targetRegions: [
        "Texas",
        "California",
        "Illinois",
        "Florida",
        "Georgia",
        "Ohio",
        "Pennsylvania",
        "New Jersey",
        "New York",
        "North Carolina",
        "Tennessee",
        "Michigan",
        "Indiana",
        "Arizona",
        "Washington",
      ],
      companySizeMin: "51-200",
      companySizeMax: "1001-5000",
      companyExamples:
        "3PLs announcing new DCs, manufacturers with multi-plant inventory pain, logistics fleets expanding with digital transformation hires.",
      disqualifiedExamples:
        "12-person trucking companies, SAP presence with no project, generic React hiring, articles older than allowed recency.",
      requiredKeywords: [],
      excludedKeywords: ["website design only", "staffing agency"],
    },
    linkedSignals: [
      {
        signalId: "stellix_rfid",
        enabled: true,
        priority: 100,
        recencyDays: 180,
        required: false,
        strength: "strong",
        instructions: "Active RFID / asset-tracking initiative. Prefer last 90 days; max 180 for ongoing rollout.",
        messageAngle:
          "Supporting the software, integrations, dashboards and device-management layer around the RFID initiative.",
      },
      {
        signalId: "stellix_iot",
        enabled: true,
        priority: 95,
        recencyDays: 180,
        required: false,
        strength: "strong",
        instructions: "IoT asset tracking / real-time monitoring tied to physical ops.",
      },
      {
        signalId: "stellix_logistics",
        enabled: true,
        priority: 90,
        recencyDays: 180,
        required: false,
        strength: "strong",
        instructions: "New warehouse/DC/plant or logistics network expansion (max 180 days).",
        messageAngle:
          "Helping build the software and integration layer required to operate the new facility with real-time visibility.",
      },
      {
        signalId: "stellix_erp_crm_portal",
        enabled: true,
        priority: 85,
        recencyDays: 120,
        required: false,
        strength: "strong",
        instructions: "WMS / TMS / ERP implementation or replacement (max 120 days).",
      },
      {
        signalId: "stellix_partner_search",
        enabled: true,
        priority: 100,
        recencyDays: 60,
        required: false,
        strength: "strong",
        instructions: "Direct vendor/partner search or RFP (max 60 days) — immediate priority.",
      },
      {
        signalId: "stellix_visibility_pain",
        enabled: true,
        priority: 80,
        recencyDays: 90,
        required: false,
        strength: "strong",
        instructions: "Inventory or visibility problem stated publicly (max 90 days).",
      },
      {
        signalId: "stellix_hiring",
        enabled: true,
        priority: 60,
        recencyDays: 60,
        required: false,
        strength: "medium",
        instructions:
          "Relevant hiring only (RFID/IoT/WMS/supply-chain systems). Generic SWE hiring does not qualify.",
      },
      {
        signalId: "stellix_leadership",
        enabled: true,
        priority: 55,
        recencyDays: 120,
        required: false,
        strength: "medium",
        instructions: "New ops/supply-chain/CIO leader (supporting only — cannot qualify alone).",
      },
      {
        signalId: "stellix_workflow_automation",
        enabled: true,
        priority: 70,
        recencyDays: 90,
        required: false,
        strength: "medium",
        instructions: "Warehouse/ops automation initiative (max 90 days).",
      },
      {
        signalId: "stellix_funding",
        enabled: true,
        priority: 50,
        recencyDays: 180,
        required: false,
        strength: "medium",
        instructions: "Acquisition / PE investment — supporting only.",
      },
      {
        signalId: "stellix_expansion",
        enabled: true,
        priority: 65,
        recencyDays: 120,
        required: false,
        strength: "medium",
        instructions: "Fleet or location expansion (max 120 days).",
      },
      {
        signalId: "stellix_compliance",
        enabled: true,
        priority: 60,
        recencyDays: 120,
        required: false,
        strength: "medium",
        instructions: "Traceability / cold-chain / chain-of-custody requirements.",
      },
    ],
    qualityChecklist: checklist(),
    dailyTargetDefault: 150,
    dailyTargets: { ...DEFAULT_DAILY_TARGETS },
    industryAllocations: [
      { label: "Logistics, transportation and 3PL", target: 45 },
      { label: "Warehousing and distribution", target: 35 },
      { label: "Manufacturing", target: 40 },
      { label: "Retail, wholesale and consumer goods supply chain", target: 15 },
      { label: "Healthcare, pharma and medical supply chain", target: 15 },
    ],
    searchTemplates: [
      {
        id: "st-facility",
        label: "Facility expansion",
        queries: [
          '"new distribution center" logistics 2026',
          '"new warehouse" manufacturing 2026',
          '"new fulfillment center" company',
          '"warehouse expansion" logistics company',
        ],
      },
      {
        id: "st-rfid",
        label: "RFID and asset tracking",
        queries: [
          '"RFID implementation" warehouse',
          '"RFID rollout" logistics',
          '"RFID asset tracking" manufacturing',
          '"real-time asset tracking" company',
        ],
      },
      {
        id: "st-pain",
        label: "Operational pain",
        queries: [
          '"inventory accuracy" company',
          '"inventory discrepancies" warehouse',
          '"lack of visibility" supply chain',
          '"shipment visibility" logistics company',
        ],
      },
      {
        id: "st-tech",
        label: "Technology projects",
        queries: [
          '"WMS implementation" company',
          '"TMS implementation" company',
          '"warehouse management system replacement"',
          '"ERP modernization" manufacturing',
        ],
      },
      {
        id: "st-hiring",
        label: "Hiring",
        queries: [
          'site:linkedin.com/jobs "RFID engineer"',
          'site:linkedin.com/jobs "warehouse systems manager"',
          'site:linkedin.com/jobs "WMS administrator"',
          'site:linkedin.com/jobs "supply chain systems"',
        ],
      },
      {
        id: "st-rfp",
        label: "RFPs and tenders",
        queries: [
          '"RFID RFP"',
          '"warehouse software RFP"',
          '"logistics software RFP"',
          '"asset tracking RFP"',
          '"IoT implementation partner"',
        ],
      },
    ],
    sopMarkdown: `## Daily process (timeboxed)

1. **Signal discovery (90m)** — Start with signals, not directories. Build a raw pool of ~180–220.
2. **Company qualification (60m)** — Industry, size, geo, physical ops, service fit.
3. **Decision-maker ID (90m)** — One ops buyer; one technical buyer when justified.
4. **Contact enrichment (90m)** — LinkedIn, verified email, company details.
5. **Evidence and scoring (90m)** — URL, date, explanation, opportunity, score, temperature.
6. **Personalization and QA (60m)** — Structured notes; deeply personalize top 15.

## Batches
Submit in 3 batches of 50 so managers can correct quality early.

## Qualification
A prospect counts only when company fit, approved persona, verified email, recent evidence (1 strong or 2 medium), personalization, opportunity type, and score ≥ 45 are complete.

## Hot rule
Score ≥ 70 **and** at least one strong signal **and** connected to a relevant decision-maker.
`,
    researchNotes:
      "Prefer company newsroom, LinkedIn, Google News, PR wires, tenders, and job boards. Confirm tech-detection findings with a second source. Spend ~80% of effort on United States.",
    version: 1,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
}
