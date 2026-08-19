import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/documents/audit";
import {
  getOrganizationIntentPlaybookServer,
  updateOrganizationIntentPlaybookServer,
} from "@/lib/intent/intent-playbook-server";
import { parseIntentPlaybook } from "@/lib/intent/parse-playbook";
import { INTENT_PLAYBOOK_TEMPLATES, playbookFromTemplate } from "@/lib/intent/playbook-templates";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";

const signalSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  category: z.enum([
    "hiring",
    "legacy_stack",
    "digital_transformation",
    "funding",
    "expansion",
    "supply_chain",
    "technology",
    "operational_pain",
    "compliance",
    "website",
    "engagement",
    "custom",
  ]),
  points: z.number().min(0).max(100),
  enabled: z.boolean(),
  keywords: z.array(z.string().max(120)).max(60),
  labelNames: z.array(z.string().max(80)).max(40).optional(),
  industries: z.array(z.string().max(80)).max(40).optional(),
  qualificationRole: z.enum(["demand", "supporting"]).optional(),
  fieldKeys: z
    .array(
      z.enum([
        "triggerEvent",
        "painPoints",
        "businessFocus",
        "hiringSignals",
        "recentNews",
        "psLine",
        "toolsUsed",
        "notes",
        "companyIndustry",
        "contactTitle",
      ]),
    )
    .max(12)
    .optional(),
});

const putSchema = z
  .object({
    templateId: z.enum([
      "stellix_soft",
      "modernization_services",
      "saas_outbound",
      "logistics_tech",
      "blank",
    ]),
    name: z.string().min(1).max(80),
    outreachThreshold: z.number().min(0).max(100),
    tempBands: z.object({
      warmMin: z.number().min(0).max(100),
      hotMin: z.number().min(0).max(100),
    }),
    autoTemperature: z.boolean(),
    signals: z.array(signalSchema).max(50),
    engagement: z.object({
      reply: z.number().min(0).max(50),
      multiTouch: z.number().min(0).max(50),
      multiTouchMin: z.number().min(1).max(20),
    }),
  })
  .strict();

  const applyTemplateSchema = z
  .object({
    applyTemplate: z.literal(true),
    templateId: z.enum([
      "stellix_soft",
      "modernization_services",
      "saas_outbound",
      "logistics_tech",
      "blank",
    ]),
  })
  .strict();

export async function GET() {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  const playbook = await getOrganizationIntentPlaybookServer(g.ctx.session.organizationId);
  const templates = Object.values(INTENT_PLAYBOOK_TEMPLATES).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }));
  return NextResponse.json({ playbook, templates });
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

  const applyTpl = applyTemplateSchema.safeParse(json);
  if (applyTpl.success) {
    const playbook = playbookFromTemplate(applyTpl.data.templateId);
    const result = await updateOrganizationIntentPlaybookServer(
      g.ctx.session.organizationId,
      playbook,
    );
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    await recordAudit({
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      event: "intent_playbook.template_applied",
      meta: { templateId: applyTpl.data.templateId },
    });
    return NextResponse.json({ ok: true, playbook: result.playbook });
  }

  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const playbook = parseIntentPlaybook(parsed.data);
  const result = await updateOrganizationIntentPlaybookServer(
    g.ctx.session.organizationId,
    playbook,
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "intent_playbook.updated",
    meta: {
      signalCount: result.playbook.signals.length,
      threshold: result.playbook.outreachThreshold,
      templateId: result.playbook.templateId,
    },
  });

  return NextResponse.json({ ok: true, playbook: result.playbook });
}
