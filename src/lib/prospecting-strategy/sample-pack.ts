import type { StrategyPack } from "@/lib/prospecting-strategy/pack";
import { emptyFirmographics } from "@/lib/prospecting-strategy/types";
import { DEFAULT_DAILY_TARGETS } from "@/lib/prospecting-strategy/qualify";

/**
 * Neutral product sample - safe to ship as the only built-in pack.
 * No Stellix Soft / Person 1 / real customer ICP content.
 */
export function buildSampleB2bSaasPack(): StrategyPack {
  return {
    packVersion: 1,
    packId: "sample-b2b-saas",
    name: "Sample B2B SaaS Prospecting",
    description:
      "Neutral demo pack for any SaaS org. Mid-market software buyers with modernization or integration intent - not a real customer ICP.",
    personas: [
      {
        id: "sample-persona-cto",
        name: "CTO / VP Engineering",
        description: "Technical leaders owning delivery, architecture, and engineering capacity.",
        department: "Engineering",
        seniority: "C-level / VP / Director",
        titles: [
          { title: "CTO", kind: "approved" },
          { title: "Chief Technology Officer", kind: "approved" },
          { title: "VP Engineering", kind: "approved" },
          { title: "Director of Engineering", kind: "approved" },
          { title: "Head of Engineering", kind: "approved" },
          { title: "Recruiter", kind: "excluded" },
          { title: "Marketing Director", kind: "excluded" },
        ],
        industries: ["Software", "SaaS", "Financial Services"],
        countries: ["United States", "Canada", "United Kingdom"],
        responsibilities: ["Engineering delivery", "Technical architecture", "Team scaling"],
        businessGoals: ["Ship faster", "Reduce technical debt", "Scale reliably"],
        painPoints: ["Legacy systems", "Slow delivery", "Integration complexity"],
        buyingTriggers: ["Legacy rewrite", "Cloud migration", "Team augmentation RFP"],
        objections: ["We have an internal team", "Budget locked this quarter"],
        relevantServices: [
          "Application modernization",
          "Cloud migration",
          "Dedicated engineering teams",
          "API integrations",
        ],
        relevantSignalIds: [],
        recommendedAngle:
          "Reduce maintenance risk and ship modern features without a hiring freeze.",
        valueProposition:
          "A senior delivery partner that modernizes core systems while your team keeps shipping.",
        callToAction: "Offer a short technical discovery on one high-risk system.",
        priority: 100,
        active: true,
      },
      {
        id: "sample-persona-cio",
        name: "CIO / IT Director",
        description: "IT leaders owning enterprise apps, integrations, and compliance.",
        department: "IT",
        seniority: "C-level / VP / Director",
        titles: [
          { title: "CIO", kind: "approved" },
          { title: "Chief Information Officer", kind: "approved" },
          { title: "IT Director", kind: "approved" },
          { title: "VP Information Technology", kind: "approved" },
          { title: "Head of Enterprise Applications", kind: "similar" },
        ],
        industries: ["Healthcare", "Financial Services", "Manufacturing"],
        countries: ["United States", "United Kingdom"],
        responsibilities: ["Enterprise applications", "Integrations", "Security & compliance"],
        businessGoals: ["Modernize IT estate", "Improve reliability", "Reduce vendor sprawl"],
        painPoints: ["Aging systems", "Integration debt", "Audit pressure"],
        buyingTriggers: ["ERP/CRM upgrade", "Compliance mandate", "M&A integration"],
        objections: ["Preferred SI already selected"],
        relevantServices: [
          "Enterprise modernization",
          "ERP and CRM integrations",
          "Workflow automation",
        ],
        relevantSignalIds: [],
        recommendedAngle: "Unify systems and cut operational drag with reliable integrations.",
        priority: 90,
        active: true,
      },
      {
        id: "sample-persona-ops",
        name: "COO / Operations Leader",
        description: "Operations leaders focused on throughput, visibility, and process.",
        department: "Operations",
        seniority: "C-level / VP / Director",
        titles: [
          { title: "COO", kind: "approved" },
          { title: "VP Operations", kind: "approved" },
          { title: "Director of Operations", kind: "approved" },
          { title: "Head of Operations", kind: "approved" },
        ],
        industries: [],
        countries: [],
        responsibilities: ["Operations excellence", "Process standardization"],
        businessGoals: ["Improve throughput", "Real-time visibility", "Lower manual work"],
        painPoints: ["Manual workflows", "Poor visibility", "Spreadsheet ops"],
        buyingTriggers: ["Ops digitization", "Dashboard initiative", "Process automation RFP"],
        objections: ["Change management risk"],
        relevantServices: ["Workflow automation", "Real-time dashboards", "Custom ops platforms"],
        relevantSignalIds: [],
        recommendedAngle: "Replace manual ops with automated workflows and live dashboards.",
        priority: 80,
        active: true,
      },
    ],
    strategy: {
      id: "sample-strategy-b2b-saas",
      name: "Sample B2B SaaS Prospecting",
      description:
        "Demo strategy for mid-market software and IT buyers with recent modernization or integration intent.",
      objective:
        "Find companies and decision-makers with recent, verifiable need for modernization, integrations, or automation.",
      missionBlurb: `Your job is to find mid-market companies with recent evidence of modernization, cloud migration, integration projects, or operational automation needs.

Start with a business signal, validate the company, identify the correct technical or operational decision-maker, verify the email, attach evidence, and explain how your services help.

Do not submit random contacts, old signals, or companies that only match an industry keyword.

A qualified prospect must answer four questions:
1. Why this company?
2. Why this decision-maker?
3. Why now?
4. Which service is relevant?`,
      status: "published",
      priority: 50,
      personaRefs: [
        "sample-persona-cto",
        "sample-persona-cio",
        "sample-persona-ops",
      ],
      firmographics: {
        ...emptyFirmographics(),
        targetIndustries: [
          "Software",
          "SaaS",
          "Financial Services",
          "Healthcare",
          "Manufacturing",
        ],
        excludedIndustries: [
          "Marketing agencies",
          "Recruitment agencies",
          "Solo freelancers",
        ],
        targetCountries: ["United States", "Canada", "United Kingdom"],
        targetRegions: ["California", "New York", "Texas", "Ontario", "London"],
        companySizeMin: "51-200",
        companySizeMax: "1001-5000",
        companyExamples:
          "Series B–D SaaS companies rewriting legacy modules; regional banks modernizing core portals; mid-market manufacturers digitizing ops.",
        disqualifiedExamples:
          "Solo consultants, staffing agencies, keyword-only matches with no project evidence.",
        requiredKeywords: [],
        excludedKeywords: ["website design only", "staffing agency"],
      },
      linkedSignals: [],
      qualityChecklist: [
        {
          id: "qc-company",
          fieldKey: "companyName",
          label: "Company name + website",
          requirement: "required",
          sortOrder: 0,
        },
        {
          id: "qc-title",
          fieldKey: "jobTitle",
          label: "Job title matches persona",
          requirement: "required",
          sortOrder: 1,
        },
        {
          id: "qc-signal",
          fieldKey: "intentSignal",
          label: "At least one recent intent signal",
          requirement: "required",
          sortOrder: 2,
        },
        {
          id: "qc-url",
          fieldKey: "signalEvidence",
          label: "Intent evidence URL + explanation",
          requirement: "required",
          sortOrder: 3,
        },
        {
          id: "qc-email",
          fieldKey: "verifiedEmail",
          label: "Verified email",
          requirement: "optional",
          sortOrder: 4,
        },
        {
          id: "qc-pers",
          fieldKey: "personalizationNote",
          label: "Company-specific personalization note",
          requirement: "optional",
          sortOrder: 5,
        },
      ],
      sopMarkdown: `## Daily process
1. Open **My Strategy** and confirm today's focus.
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
        "Prefer LinkedIn, careers pages, company news, and technology lookups. Attach evidence URLs.",
      searchTemplates: [
        {
          id: "st-modernize",
          label: "Modernization",
          queries: [
            '"legacy modernization" software 2026',
            '"application rewrite" company',
            '"digital transformation" mid-market',
          ],
        },
        {
          id: "st-cloud",
          label: "Cloud and migration",
          queries: [
            '"cloud migration" enterprise',
            '"migrate to azure" OR "migrate to aws" company',
            '"leaving on-prem" software',
          ],
        },
        {
          id: "st-hiring",
          label: "Hiring signals",
          queries: [
            'site:linkedin.com/jobs "platform engineer"',
            'site:linkedin.com/jobs "integration architect"',
            'site:linkedin.com/jobs "legacy modernization"',
          ],
        },
      ],
      dailyTargets: {
        ...DEFAULT_DAILY_TARGETS,
        completed: 40,
        uniqueCompanies: 25,
        verifiedEmails: 35,
        withEvidence: 40,
        withRecentSignal: 40,
        warm: 10,
        hot: 4,
        deeplyPersonalized: 5,
      },
      industryAllocations: [
        { label: "Software / SaaS", target: 20 },
        { label: "Financial Services", target: 10 },
        { label: "Healthcare", target: 5 },
        { label: "Manufacturing", target: 5 },
      ],
      dailyTargetDefault: 40,
      version: 1,
    },
  };
}
