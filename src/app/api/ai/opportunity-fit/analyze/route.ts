import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { buildRagInstructionBlock } from "@/lib/ai/prompt-defaults";
import { retrieveFitCheckRagChunksServer } from "@/lib/ai/fit-check-knowledge";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  OPPORTUNITY_SOURCE_TYPES,
  normalizeOpportunityFitResult,
  opportunityFitResultSchema,
} from "@/lib/ai/opportunity-fit-types";
import { createOpportunityScanServer } from "@/lib/ai/opportunity-fit-server";
import { demoOpportunityFitResult } from "@/lib/ai/demo-opportunity-fit";
import { isAuthDisabled } from "@/lib/auth/flags";
import { recordAudit } from "@/lib/firestore/audit";
import type { Role } from "@/lib/types";

const bodySchema = z.object({
  rawInput: z.string().min(40, "Paste at least a few sentences about the opportunity."),
  sourceType: z.enum(OPPORTUNITY_SOURCE_TYPES),
  title: z.string().max(200).optional(),
  leadId: z.string().optional(),
  demo: z.boolean().optional(),
});

function titleFromInput(raw: string, title?: string): string {
  const t = title?.trim();
  if (t) return t.slice(0, 200);
  const line = raw.split(/\n/).find((l) => l.trim().length > 8)?.trim();
  return (line ?? "Opportunity check").slice(0, 120);
}

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const db = getAdminDb();
  const userSnap = await db?.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap?.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "opportunity_fit", roleId)) {
    return NextResponse.json(
      { error: "Opportunity fit check is not enabled for your role." },
      { status: 403 },
    );
  }

  const scanTitle = titleFromInput(parsed.data.rawInput, parsed.data.title);
  const useDemo = parsed.data.demo === true || isAuthDisabled();

  let result;
  if (useDemo) {
    result = normalizeOpportunityFitResult(
      demoOpportunityFitResult(parsed.data.sourceType, scanTitle),
    );
  } else {
    const feat = settings.features.opportunity_fit;
    const ragMode = feat.ragMode ?? "strict";
    const query = `${parsed.data.sourceType} ${parsed.data.rawInput.slice(0, 2000)}`;
    const chunks = await retrieveFitCheckRagChunksServer({
      organizationId: orgId,
      query,
      sourceType: parsed.data.sourceType,
    });
    const ragBlock = buildRagInstructionBlock(
      ragMode,
      chunks.map((c) => ({ title: c.title, content: c.content })),
    );

    try {
      const raw = await runAiStructuredFeature({
        organizationId: orgId,
        userId: uid,
        userDisplayName: g.ctx.session.name,
        roleId,
        feature: "opportunity_fit",
        promptVars: {
          sourceType: parsed.data.sourceType,
          title: scanTitle,
          opportunityText: parsed.data.rawInput.slice(0, 24000),
          ragBlock: ragBlock || "(No knowledge base chunks retrieved — score using opportunity text only and note gaps.)",
        },
        schema: opportunityFitResultSchema,
      });
      result = normalizeOpportunityFitResult(raw);
    } catch (e) {
      return aiErrorResponse(e);
    }

    if (result.ragCitations.length === 0 && chunks.length > 0) {
      result = {
        ...result,
        ragCitations: chunks.slice(0, 4).map((c) => ({
          title: c.title,
          excerpt: c.content.slice(0, 280),
        })),
      };
    }
  }

  const saved = await createOpportunityScanServer({
    organizationId: orgId,
    userId: uid,
    userDisplayName: g.ctx.session.name,
    title: scanTitle,
    sourceType: parsed.data.sourceType,
    rawInput: parsed.data.rawInput,
    result,
    leadId: parsed.data.leadId,
  });

  if ("error" in saved) {
    return NextResponse.json(
      { result, scanId: null, warning: saved.error },
      { status: 200 },
    );
  }

  void recordAudit({
    organizationId: orgId,
    actorUid: uid,
    event: "feature.fit_check",
    meta: {
      scanId: saved.scan.id,
      sourceType: parsed.data.sourceType,
      title: scanTitle,
      leadId: parsed.data.leadId,
      demo: useDemo,
    },
  });

  return NextResponse.json({ result, scan: saved.scan });
}
