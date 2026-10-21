import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stampForCreate } from "@/lib/documents/tenant-write";
import { ingestWebsiteLeadServer } from "@/lib/integrations/website-lead-ingest-server";

const bodySchema = z.object({
  /** Tenant id this lead belongs to. Required (multi-tenant). */
  organizationId: z.string().min(1),
  source: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactName: z.string().min(1).optional(),
  companyName: z.string().min(1).optional(),
  channel: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  // Tenant-aware webhook secret. Two modes:
  //  1) Legacy single-tenant: INBOUND_WEBHOOK_SECRET still works (for backward compat).
  //  2) Per-tenant: organizations/{orgId}.settings.inboundWebhookSecret on the doc.
  const fallbackSecret = process.env.INBOUND_WEBHOOK_SECRET;

  const authHeader = req.headers.get("authorization");
  const headerSecret = req.headers.get("x-webhook-secret");
  const presented =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : headerSecret;

  if (!presented) return unauthorized();

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Document store is not configured" },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Verify the secret against the tenant doc (or fallback env).
  const orgRef = db
    .collection(COLLECTIONS.organizations)
    .doc(parsed.data.organizationId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    return unauthorized();
  }
  const orgData = orgSnap.data() ?? {};
  const settings = (orgData.settings ?? {}) as {
    inboundWebhookSecret?: string;
  };
  const fromSettings =
    typeof settings.inboundWebhookSecret === "string"
      ? settings.inboundWebhookSecret.trim()
      : "";
  const fromLegacy =
    typeof orgData.inboundWebhookSecret === "string"
      ? String(orgData.inboundWebhookSecret).trim()
      : "";
  const orgSecret = fromSettings || fromLegacy || null;
  const accepted = orgSecret ? presented === orgSecret : presented === fallbackSecret;
  if (!accepted) return unauthorized();

  // Create the prospect now (nothing consumes ingestQueue — QA 2.1). The queue
  // doc stays as the audit record of what the website sent.
  let ingest: Awaited<ReturnType<typeof ingestWebsiteLeadServer>>;
  try {
    ingest = await ingestWebsiteLeadServer(parsed.data);
  } catch (err) {
    console.error("[webhook/lead] ingest failed", err);
    ingest = { ok: false, error: "Could not create the lead." };
  }

  const ref = await db.collection(COLLECTIONS.ingestQueue).add(
    stampForCreate(parsed.data.organizationId, {
      type: "website_lead",
      payload: parsed.data,
      receivedAt: FieldValue.serverTimestamp(),
      status: ingest.ok ? "processed" : "failed",
      ...(ingest.ok
        ? { leadId: ingest.leadId, duplicate: ingest.duplicate, processedAt: FieldValue.serverTimestamp() }
        : { error: ingest.error }),
    }),
  );

  if (!ingest.ok) {
    return NextResponse.json({ ok: false, id: ref.id, error: ingest.error }, { status: 422 });
  }
  return NextResponse.json({
    ok: true,
    id: ref.id,
    leadId: ingest.leadId,
    duplicate: ingest.duplicate,
  });
}
