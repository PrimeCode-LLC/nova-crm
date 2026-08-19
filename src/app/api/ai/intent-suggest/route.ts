import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { buildLeadAiContext } from "@/lib/ai/context/lead-context";
import { loadLeadAiContextServer } from "@/lib/ai/load-lead-ai-context-server";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { getOrganizationIntentPlaybookServer } from "@/lib/intent/intent-playbook-server";
import { computeQualityScore } from "@/lib/intent/compute-quality-score";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { recordAudit } from "@/lib/documents/audit";
import type { Role } from "@/lib/types";

const suggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      field: z.enum([
        "hiringSignals",
        "triggerEvent",
        "painPoints",
        "recentNews",
        "businessFocus",
      ]),
      value: z.string(),
      signalLabel: z.string(),
      rationale: z.string(),
      // OpenAI structured output requires every property to be in `required`
      // (optional Zod fields are rejected with invalid_json_schema).
      signalId: z.string(),
    }),
  ),
});

const bodySchema = z.object({
  leadId: z.string().min(1),
  demoContext: z
    .object({
      lead: z.record(z.string(), z.unknown()),
      account: z.record(z.string(), z.unknown()).optional(),
      contact: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

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
  if (!canUseAiFeature(settings, "intent_suggest", roleId)) {
    return NextResponse.json(
      { error: "Intent suggest is not enabled for your role." },
      { status: 403 },
    );
  }

  const loaded = await loadLeadAiContextServer({
    organizationId: orgId,
    leadId: parsed.data.leadId,
    demoContext: parsed.data.demoContext,
  });
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const playbook = await getOrganizationIntentPlaybookServer(orgId);
  const quality = computeQualityScore(loaded.lead, playbook);
  const playbookSignals = playbook.signals
    .filter((s) => s.enabled)
    .map((s) => `- ${s.id}: ${s.label} [${s.keywords.slice(0, 8).join(", ")}]`)
    .join("\n");

  const context = buildLeadAiContext(loaded);

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "intent_suggest",
      promptVars: {
        context,
        playbookSignals: playbookSignals || "(none)",
        matchedSignalIds: quality.matchedSignals.map((m) => m.signalId).join(", ") || "(none)",
      },
      schema: suggestionsSchema,
      leadId: parsed.data.leadId,
    });
    void recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "feature.intent_suggest",
      meta: { leadId: parsed.data.leadId },
    });
    return NextResponse.json(result);
  } catch (e) {
    return aiErrorResponse(e, {
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      actorEmail: g.ctx.session.email,
      location: "src/app/api/ai/intent-suggest/route.ts",
      functionName: "handler",
      route: "/api/ai/intent-suggest",
    });
  }
}
