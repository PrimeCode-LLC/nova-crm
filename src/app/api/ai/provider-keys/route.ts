import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { upsertAiProviderKeysServer, getAiProviderKeyFlagsServer } from "@/lib/ai/ai-secrets-server";
import { recordAudit } from "@/lib/firestore/audit";

const putSchema = z
  .object({
    openai: z.string().optional(),
    anthropic: z.string().optional(),
    google: z.string().optional(),
  })
  .strict();

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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const keys: Partial<Record<"openai" | "anthropic" | "google", string>> = {};
  if (parsed.data.openai?.trim()) keys.openai = parsed.data.openai.trim();
  if (parsed.data.anthropic?.trim()) keys.anthropic = parsed.data.anthropic.trim();
  if (parsed.data.google?.trim()) keys.google = parsed.data.google.trim();

  if (Object.keys(keys).length === 0) {
    return NextResponse.json({ error: "Provide at least one provider key" }, { status: 400 });
  }

  const result = await upsertAiProviderKeysServer({
    organizationId: g.ctx.session.organizationId,
    keys,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "ai.key_rotated",
    meta: { providers: Object.keys(keys) },
  });

  const keyFlags = await getAiProviderKeyFlagsServer(g.ctx.session.organizationId);
  return NextResponse.json({ keyFlags });
}
