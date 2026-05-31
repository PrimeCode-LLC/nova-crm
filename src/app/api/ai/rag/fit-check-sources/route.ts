import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { OPPORTUNITY_SOURCE_TYPES, type OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import { getFitCheckKnowledgeConfigServer } from "@/lib/ai/fit-check-knowledge";

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const config = await getFitCheckKnowledgeConfigServer(g.ctx.session.organizationId);

  const sourceTypes = (OPPORTUNITY_SOURCE_TYPES as OpportunitySourceType[]).filter((t) => {
    // Only hide categories when they're disabled in Fit Check knowledge config.
    return config.categories[t]?.enabled !== false;
  });

  return NextResponse.json({ sourceTypes });
}

