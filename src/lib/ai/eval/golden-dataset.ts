/**
 * Frozen golden eval fixtures (shared by seed script + Lab API).
 */

export type GoldenFixture = {
  label: string;
  segment: string;
  leadContext: Record<string, unknown>;
  threadContext?: Record<string, unknown>;
};

const BASE: GoldenFixture[] = [
  {
    label: "Cold VP Eng SaaS",
    segment: "cold_vp_engineering",
    leadContext: {
      contactName: "Jane Doe",
      contactTitle: "VP Engineering",
      companyName: "Acme Corp",
      companyIndustry: "B2B SaaS",
      companySize: "201-500",
      notes: "Hiring velocity mentioned on careers page",
    },
  },
  {
    label: "Warm founder reply later",
    segment: "warm_founder",
    leadContext: {
      contactName: "Sam Rivera",
      contactTitle: "Founder",
      companyName: "Brightline Analytics",
      companyIndustry: "Analytics",
      temperature: "warm",
    },
  },
  {
    label: "Replan after positive reply",
    segment: "replan_after_reply",
    leadContext: {
      contactName: "Priya Shah",
      contactTitle: "Head of Sales",
      companyName: "Northwind Tools",
      companyIndustry: "Manufacturing software",
    },
    threadContext: {
      lastInbound: "Interesting — can you send a 1-pager for my ops lead?",
    },
  },
  {
    label: "IC individual contributor",
    segment: "ic_engineer",
    leadContext: {
      contactName: "Chris Park",
      contactTitle: "Senior Engineer",
      companyName: "Helio Cloud",
      companyIndustry: "Cloud infrastructure",
    },
  },
  {
    label: "Enterprise procurement",
    segment: "enterprise_procurement",
    leadContext: {
      contactName: "Morgan Lee",
      contactTitle: "Director of Procurement",
      companyName: "Summit Health",
      companyIndustry: "Healthcare",
      companySize: "1000+",
    },
  },
];

const INDUSTRIES = ["Fintech", "EdTech", "Logistics", "HR Tech", "Cybersecurity"];

/** ~30 frozen golden items spanning seniority + industry. */
export function getGoldenFixtures(): GoldenFixture[] {
  const fixtures = [...BASE];
  while (fixtures.length < 30) {
    const base = BASE[fixtures.length % BASE.length]!;
    const industry = INDUSTRIES[fixtures.length % INDUSTRIES.length]!;
    fixtures.push({
      ...base,
      label: `${base.label} · ${industry}`,
      segment: `${base.segment}_${industry.toLowerCase().replace(/\s+/g, "_")}`,
      leadContext: {
        ...base.leadContext,
        companyIndustry: industry,
        companyName: `${String(base.leadContext.companyName)} ${industry}`,
      },
    });
  }
  return fixtures;
}
