import type {
  IntentPlaybook,
  IntentPlaybookTemplateId,
  IntentSignalDefinition,
} from "@/lib/intent/types";
import { stellixSoftPlaybook } from "@/lib/intent/stellix-soft-playbook";

const RESEARCH_FIELDS = [
  "triggerEvent",
  "painPoints",
  "businessFocus",
  "hiringSignals",
  "recentNews",
  "psLine",
  "toolsUsed",
  "notes",
  "contactTitle",
] as const;

function sig(
  partial: Omit<IntentSignalDefinition, "enabled"> & { enabled?: boolean },
): IntentSignalDefinition {
  return { enabled: true, fieldKeys: [...RESEARCH_FIELDS], ...partial };
}

/** Your modernization / .NET services playbook — default for new orgs. */
export function modernizationServicesPlaybook(): IntentPlaybook {
  return {
    templateId: "modernization_services",
    name: "Modernization services",
    outreachThreshold: 40,
    tempBands: { warmMin: 40, hotMin: 70 },
    autoTemperature: true,
    engagement: { reply: 10, multiTouch: 5, multiTouchMin: 3 },
    signals: [
      sig({
        id: "hiring_devs",
        label: "Hiring developers",
        category: "hiring",
        points: 25,
        keywords: [
          "hiring",
          ".net developer",
          "software engineer",
          "qa engineer",
          "devops",
          "cloud engineer",
          "rfid engineer",
          "iot engineer",
          "full stack",
          "backend engineer",
          "frontend engineer",
        ],
        fieldKeys: ["hiringSignals", "triggerEvent", "recentNews", "notes"],
      }),
      sig({
        id: "legacy_dotnet",
        label: "Legacy .NET stack",
        category: "legacy_stack",
        points: 25,
        keywords: [
          "asp.net",
          "vb.net",
          "webforms",
          "web forms",
          ".net framework",
          "legacy .net",
          "winforms",
        ],
        labelNames: [".net", ".Net", "ASP.NET", "VB.NET"],
        fieldKeys: ["toolsUsed", "triggerEvent", "painPoints", "businessFocus", "notes"],
      }),
      sig({
        id: "funding",
        label: "Funding event",
        category: "funding",
        points: 20,
        keywords: [
          "series a",
          "series b",
          "series c",
          "private equity",
          "raised",
          "funding",
          "acquisition",
          "acquired",
          "investment",
        ],
        fieldKeys: ["recentNews", "triggerEvent", "notes"],
      }),
      sig({
        id: "warehouse_expansion",
        label: "Warehouse / facility expansion",
        category: "expansion",
        points: 20,
        keywords: [
          "new office",
          "new warehouse",
          "new facility",
          "new plant",
          "expansion",
          "opening a",
          "expanding into",
          "new country",
        ],
        fieldKeys: ["recentNews", "triggerEvent", "hiringSignals", "notes"],
      }),
      sig({
        id: "erp_stack",
        label: "Oracle / SAP / Dynamics / NetSuite",
        category: "technology",
        points: 15,
        keywords: ["oracle", "sap", "dynamics", "netsuite", "microsoft dynamics"],
        labelNames: ["Oracle", "SAP", "Dynamics", "NetSuite"],
        fieldKeys: ["toolsUsed", "businessFocus", "painPoints", "notes"],
      }),
      sig({
        id: "rfid_iot",
        label: "RFID / IoT relevance",
        category: "supply_chain",
        points: 15,
        keywords: [
          "rfid",
          "iot",
          "asset tracking",
          "warehouse automation",
          "inventory visibility",
          "logistics technology",
        ],
        labelNames: ["RFID", "IoT"],
        fieldKeys: ["toolsUsed", "painPoints", "businessFocus", "hiringSignals", "notes"],
      }),
      sig({
        id: "digital_transformation",
        label: "Digital transformation",
        category: "digital_transformation",
        points: 12,
        keywords: [
          "modernization",
          "transformation",
          "cloud migration",
          "automation",
          "erp implementation",
          "process improvement",
          "digital transformation",
        ],
        fieldKeys: ["businessFocus", "painPoints", "recentNews", "triggerEvent", "notes"],
      }),
      sig({
        id: "operational_pain",
        label: "Operational pain",
        category: "operational_pain",
        points: 12,
        keywords: [
          "manual process",
          "spreadsheet",
          "reporting delay",
          "inventory issue",
          "visibility problem",
          "slow approval",
          "transaction friction",
        ],
        fieldKeys: ["painPoints", "triggerEvent", "notes", "psLine"],
      }),
      sig({
        id: "compliance_industry",
        label: "Compliance industry",
        category: "compliance",
        points: 10,
        keywords: [],
        industries: [
          "healthcare",
          "pharma",
          "pharmaceutical",
          "manufacturing",
          "food",
          "medical",
          "life sciences",
        ],
        fieldKeys: ["companyIndustry"],
      }),
      sig({
        id: "website_opportunity",
        label: "Website modernization",
        category: "website",
        points: 8,
        keywords: [
          "outdated website",
          "old website",
          "slow site",
          "broken ux",
          "website redesign",
          "legacy website",
        ],
        fieldKeys: ["painPoints", "triggerEvent", "notes", "recentNews"],
      }),
      sig({
        id: "linkedin_activity",
        label: "Recent LinkedIn / content",
        category: "custom",
        points: 8,
        keywords: [
          "linkedin post",
          "published",
          "article",
          "blog post",
          "thought leadership",
          "webinar",
        ],
        fieldKeys: ["recentNews", "psLine", "notes"],
      }),
    ],
  };
}

export function saasOutboundPlaybook(): IntentPlaybook {
  return {
    templateId: "saas_outbound",
    name: "SaaS outbound",
    outreachThreshold: 40,
    tempBands: { warmMin: 40, hotMin: 70 },
    autoTemperature: true,
    engagement: { reply: 12, multiTouch: 6, multiTouchMin: 3 },
    signals: [
      sig({
        id: "hiring_growth",
        label: "Hiring / growth",
        category: "hiring",
        points: 20,
        keywords: ["hiring", "open role", "headcount", "scaling team", "growing"],
        fieldKeys: ["hiringSignals", "triggerEvent", "recentNews"],
      }),
      sig({
        id: "funding_saas",
        label: "Funding",
        category: "funding",
        points: 25,
        keywords: ["series a", "series b", "raised", "funding", "venture"],
        fieldKeys: ["recentNews", "triggerEvent"],
      }),
      sig({
        id: "tech_stack_saas",
        label: "Relevant stack",
        category: "technology",
        points: 15,
        keywords: ["salesforce", "hubspot", "segment", "snowflake", "aws", "kubernetes"],
        labelNames: ["Salesforce", "HubSpot", "AWS"],
        fieldKeys: ["toolsUsed", "businessFocus"],
      }),
      sig({
        id: "pain_saas",
        label: "Buyer pain",
        category: "operational_pain",
        points: 18,
        keywords: ["churn", "pipeline", "manual", "reporting", "visibility", "attribution"],
        fieldKeys: ["painPoints", "triggerEvent", "psLine"],
      }),
      sig({
        id: "expansion_saas",
        label: "Expansion",
        category: "expansion",
        points: 15,
        keywords: ["new market", "expansion", "international", "new office"],
        fieldKeys: ["recentNews", "triggerEvent"],
      }),
    ],
  };
}

export function logisticsTechPlaybook(): IntentPlaybook {
  return {
    templateId: "logistics_tech",
    name: "Logistics & supply chain tech",
    outreachThreshold: 40,
    tempBands: { warmMin: 40, hotMin: 70 },
    autoTemperature: true,
    engagement: { reply: 10, multiTouch: 5, multiTouchMin: 3 },
    signals: [
      sig({
        id: "warehouse_auto",
        label: "Warehouse automation",
        category: "supply_chain",
        points: 25,
        keywords: [
          "warehouse automation",
          "wms",
          "inventory visibility",
          "asset tracking",
          "rfid",
          "logistics",
        ],
        labelNames: ["RFID", "WMS", "IoT"],
        fieldKeys: ["painPoints", "businessFocus", "toolsUsed", "hiringSignals", "notes"],
      }),
      sig({
        id: "facility_expansion",
        label: "New facility / warehouse",
        category: "expansion",
        points: 22,
        keywords: ["new warehouse", "new facility", "distribution center", "fulfillment"],
        fieldKeys: ["recentNews", "triggerEvent", "hiringSignals"],
      }),
      sig({
        id: "hiring_ops",
        label: "Hiring ops / engineers",
        category: "hiring",
        points: 18,
        keywords: ["hiring", "warehouse", "logistics", "supply chain", "iot", "devops"],
        fieldKeys: ["hiringSignals", "triggerEvent"],
      }),
      sig({
        id: "erp_logistics",
        label: "ERP / WMS stack",
        category: "technology",
        points: 15,
        keywords: ["sap", "oracle", "netsuite", "manhattan", "blue yonder"],
        fieldKeys: ["toolsUsed", "businessFocus"],
      }),
      sig({
        id: "compliance_mfg",
        label: "Regulated industry",
        category: "compliance",
        points: 12,
        keywords: [],
        industries: ["manufacturing", "food", "pharma", "healthcare", "automotive"],
        fieldKeys: ["companyIndustry"],
      }),
    ],
  };
}

export function blankPlaybook(): IntentPlaybook {
  return {
    templateId: "blank",
    name: "Custom playbook",
    outreachThreshold: 40,
    tempBands: { warmMin: 40, hotMin: 70 },
    autoTemperature: false,
    engagement: { reply: 10, multiTouch: 5, multiTouchMin: 3 },
    signals: [],
  };
}

export const INTENT_PLAYBOOK_TEMPLATES: Record<
  IntentPlaybookTemplateId,
  { id: IntentPlaybookTemplateId; name: string; description: string; build: () => IntentPlaybook }
> = {
  stellix_soft: {
    id: "stellix_soft",
    name: "Stellix Soft Qualified Opportunities",
    description:
      "Master Stellix Soft playbook: partner-search, modernization, IoT/RFID, logistics, enterprise apps, integrations, cloud, AI — with qualification gates and primary opportunity routing.",
    build: stellixSoftPlaybook,
  },
  modernization_services: {
    id: "modernization_services",
    name: "Modernization services",
    description: ".NET legacy, hiring, funding, warehouse, ERP — ideal for custom software / modernization sellers.",
    build: modernizationServicesPlaybook,
  },
  saas_outbound: {
    id: "saas_outbound",
    name: "SaaS outbound",
    description: "Funding, growth hiring, stack fit, and buyer pain for B2B SaaS.",
    build: saasOutboundPlaybook,
  },
  logistics_tech: {
    id: "logistics_tech",
    name: "Logistics & supply chain",
    description: "Warehouse automation, RFID/IoT, facilities, and regulated industries.",
    build: logisticsTechPlaybook,
  },
  blank: {
    id: "blank",
    name: "Blank (custom)",
    description: "Start empty and define your own signals.",
    build: blankPlaybook,
  },
};

/** Default playbook for orgs that have not configured one yet. */
export function defaultIntentPlaybook(): IntentPlaybook {
  return stellixSoftPlaybook();
}

export function playbookFromTemplate(id: IntentPlaybookTemplateId): IntentPlaybook {
  return INTENT_PLAYBOOK_TEMPLATES[id].build();
}
