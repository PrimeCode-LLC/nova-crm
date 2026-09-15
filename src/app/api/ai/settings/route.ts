import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  getAiSettingsForApiServer,
  updateOrganizationAiSettingsServer,
} from "@/lib/ai/ai-settings-server";
import { isAiEncryptionConfigured } from "@/lib/ai/ai-secrets-server";
import { recordAudit } from "@/lib/documents/audit";

export async function GET() {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const { settings, keyFlags } = await getAiSettingsForApiServer(g.ctx.session.organizationId);
  return NextResponse.json({
    settings,
    keyFlags,
    encryptionConfigured: isAiEncryptionConfigured(),
  });
}

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultProvider: z.enum(["openai", "anthropic", "google"]).optional(),
    defaultModel: z.string().min(1).max(120).optional(),
    dailyTokenCap: z.number().int().positive().optional().nullable(),
    embeddingModel: z.string().max(120).optional(),
    embeddingProvider: z.enum(["openai", "anthropic", "google"]).optional(),
    features: z.record(z.string(), z.unknown()).optional(),
    /** Inbox-placement seed inboxes (injected into bulk outbound batches). */
    seedAddresses: z.array(z.string().email().max(320)).max(20).optional(),
  })
  .strict();

export async function PATCH(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await updateOrganizationAiSettingsServer(
    g.ctx.session.organizationId,
    parsed.data as Parameters<typeof updateOrganizationAiSettingsServer>[1],
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "ai.settings_updated",
    meta: { fields: Object.keys(parsed.data) },
  });

  const { settings, keyFlags } = await getAiSettingsForApiServer(g.ctx.session.organizationId);
  return NextResponse.json({ settings, keyFlags });
}
