/**
 * Seed a frozen golden eval dataset for an org.
 * Usage: npx tsx scripts/seed-eval-dataset.ts --org=<organizationId>
 */

import { randomUUID } from "node:crypto";
import { withOrganizationScope } from "../src/lib/db/tenant-scope";
import { isDatabaseConfigured } from "../src/lib/db/prisma";

const FIXTURES: Array<{
  label: string;
  segment: string;
  leadContext: Record<string, unknown>;
  threadContext?: Record<string, unknown>;
}> = [
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

// Expand to ~30 by cloning with industry variants
const INDUSTRIES = ["Fintech", "EdTech", "Logistics", "HR Tech", "Cybersecurity"];
while (FIXTURES.length < 30) {
  const base = FIXTURES[FIXTURES.length % 5]!;
  const industry = INDUSTRIES[FIXTURES.length % INDUSTRIES.length]!;
  FIXTURES.push({
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

async function main() {
  const orgArg = process.argv.find((a) => a.startsWith("--org="));
  const organizationId = orgArg?.slice("--org=".length)?.trim();
  if (!organizationId) {
    console.error("Usage: npx tsx scripts/seed-eval-dataset.ts --org=<organizationId>");
    process.exit(1);
  }
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL not configured");
    process.exit(1);
  }

  let upserted = 0;
  await withOrganizationScope(organizationId, async (tx) => {
    for (const f of FIXTURES) {
      const id = `edi-${randomUUID()}`;
      await tx.evalDatasetItem.create({
        data: {
          id,
          organizationId,
          datasetKey: "golden_v1",
          label: f.label,
          segment: f.segment,
          leadContext: f.leadContext,
          threadContext: f.threadContext ?? undefined,
          active: true,
        },
      });
      upserted += 1;
    }
  });
  console.info("[seed-eval-dataset]", { organizationId, upserted });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
