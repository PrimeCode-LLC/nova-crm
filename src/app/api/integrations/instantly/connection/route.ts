import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { roleAtLeast } from "@/lib/platform/org-role";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  clearInstantlyApiKeyServer,
  hasInstantlyApiKeyServer,
  isInstantlyEncryptionConfigured,
  upsertInstantlyApiKeyServer,
} from "@/lib/integrations/instantly/secrets";
import { recordAudit } from "@/lib/documents/audit";

async function getOrCreateInstantlyWebhookSecret(organizationId: string): Promise<string | null> {
  const db = getAdminDb();
  if (!db) return null;
  const orgRef = db.collection(COLLECTIONS.organizations).doc(organizationId);
  const snap = await orgRef.get();
  const settings = (snap.data()?.settings ?? {}) as { instantlyWebhookSecret?: string };
  let secret = settings.instantlyWebhookSecret?.trim();
  if (!secret) {
    secret = crypto.randomBytes(24).toString("hex");
    await orgRef.set(
      {
        settings: {
          ...settings,
          instantlyWebhookSecret: secret,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }
  return secret;
}

const putSchema = z
  .object({
    apiKey: z.string().min(8),
  })
  .strict();

export async function GET() {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const connected = await hasInstantlyApiKeyServer(orgId);
  const canManageWebhook = roleAtLeast(g.ctx.role, "admin");

  let webhookSecret: string | undefined;
  if (connected && canManageWebhook) {
    const secret = await getOrCreateInstantlyWebhookSecret(orgId);
    if (secret) webhookSecret = secret;
  }

  return NextResponse.json({
    connected,
    encryptionConfigured: isInstantlyEncryptionConfigured(),
    webhookSecret,
    canManageWebhook,
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
  const result = await upsertInstantlyApiKeyServer({
    organizationId: orgId,
    apiKey: parsed.data.apiKey,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const webhookSecret = await getOrCreateInstantlyWebhookSecret(orgId);

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "instantly.connected",
  });

  return NextResponse.json({
    connected: true,
    webhookSecret: webhookSecret ?? undefined,
  });
}

export async function DELETE() {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const result = await clearInstantlyApiKeyServer(orgId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "instantly.disconnected",
  });

  return NextResponse.json({ connected: false });
}
