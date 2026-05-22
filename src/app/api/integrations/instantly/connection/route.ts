import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  clearInstantlyApiKeyServer,
  hasInstantlyApiKeyServer,
  isInstantlyEncryptionConfigured,
  upsertInstantlyApiKeyServer,
} from "@/lib/integrations/instantly/secrets";
import { buildInstantlyWebhookUrl } from "@/lib/integrations/instantly/webhook-url";
import { recordAudit } from "@/lib/firestore/audit";

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
  const db = getAdminDb();
  let hasWebhookSecret = false;
  if (db) {
    const snap = await db.collection(COLLECTIONS.organizations).doc(orgId).get();
    const settings = (snap.data()?.settings ?? {}) as { instantlyWebhookSecret?: string };
    hasWebhookSecret = Boolean(settings.instantlyWebhookSecret?.trim());
  }

  return NextResponse.json({
    connected,
    encryptionConfigured: isInstantlyEncryptionConfigured(),
    webhookUrl: buildInstantlyWebhookUrl(orgId),
    hasWebhookSecret,
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

  const db = getAdminDb();
  if (db) {
    const orgRef = db.collection(COLLECTIONS.organizations).doc(orgId);
    const snap = await orgRef.get();
    const settings = (snap.data()?.settings ?? {}) as { instantlyWebhookSecret?: string };
    if (!settings.instantlyWebhookSecret?.trim()) {
      const secret = crypto.randomBytes(24).toString("hex");
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
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "instantly.connected",
  });

  return NextResponse.json({
    connected: true,
    webhookUrl: buildInstantlyWebhookUrl(orgId),
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
