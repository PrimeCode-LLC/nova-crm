import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/firestore/audit";
import {
  getOrganizationIntakeFilterDefaultsServer,
  updateOrganizationIntakeFilterDefaultsServer,
} from "@/lib/intake/intake-filter-defaults-server";
import { normalizeKeywordList } from "@/lib/intake/keyword-filter";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";

const keywordListSchema = z.array(z.string().max(120)).max(100);

const putSchema = z
  .object({
    includeKeywords: keywordListSchema,
    excludeKeywords: keywordListSchema,
  })
  .strict();

export async function GET() {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  const defaults = await getOrganizationIntakeFilterDefaultsServer(g.ctx.session.organizationId);
  return NextResponse.json({ defaults });
}

export async function PUT(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const orgId = g.ctx.session.organizationId;
  const defaults = {
    includeKeywords: normalizeKeywordList(parsed.data.includeKeywords),
    excludeKeywords: normalizeKeywordList(parsed.data.excludeKeywords),
  };

  const result = await updateOrganizationIntakeFilterDefaultsServer(orgId, defaults);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "intake_filter_defaults.updated",
    meta: {
      includeCount: defaults.includeKeywords.length,
      excludeCount: defaults.excludeKeywords.length,
    },
  });

  return NextResponse.json({ ok: true, defaults });
}
