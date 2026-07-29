import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { recordAudit } from "@/lib/firestore/audit";
import {
  clearMillionVerifierApiKeyServer,
  getMillionVerifierApiKeyServer,
  hasMillionVerifierApiKeyServer,
  isMillionVerifierEncryptionConfigured,
  upsertMillionVerifierApiKeyServer,
} from "@/lib/integrations/millionverifier/secrets";
import { getCredits } from "@/lib/integrations/millionverifier/client";

const putSchema = z
  .object({
    apiKey: z.string().min(8),
  })
  .strict();

export async function GET() {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const connected = await hasMillionVerifierApiKeyServer(orgId);

  let credits: number | null = null;
  if (connected) {
    const apiKey = await getMillionVerifierApiKeyServer(orgId);
    if (apiKey) {
      credits = await getCredits(apiKey);
    }
  }

  return NextResponse.json({
    connected,
    encryptionConfigured: isMillionVerifierEncryptionConfigured(),
    credits,
  });
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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const result = await upsertMillionVerifierApiKeyServer({
    organizationId: orgId,
    apiKey: parsed.data.apiKey,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const credits = await getCredits(parsed.data.apiKey.trim());

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "millionverifier.connected",
  });

  return NextResponse.json({
    connected: true,
    credits,
  });
}

export async function DELETE() {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const result = await clearMillionVerifierApiKeyServer(orgId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "millionverifier.disconnected",
  });

  return NextResponse.json({ connected: false });
}
