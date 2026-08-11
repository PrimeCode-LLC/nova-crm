/**
 * P3.4 — force-recompute one org's Postgres dashboard summary (Cloud Functions notify).
 * Auth: Bearer CRON_SECRET (same as other cron routes).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { recomputeOrgDashboardSummaryPostgres } from "@/lib/db/org-dashboard-summary-refresh";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";

export const maxDuration = 120;

const bodySchema = z.object({
  organizationId: z.string().trim().min(1).max(128),
});

export async function POST(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "organizationId required" },
      { status: 400 },
    );
  }

  const result = await recomputeOrgDashboardSummaryPostgres(parsed.data.organizationId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    organizationId: result.summary.organizationId,
    updatedAt: result.summary.updatedAt,
    openSalesLeads: result.summary.openSalesLeads,
    openPipelineValue: result.summary.openPipelineValue,
  });
}
