import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate } from "@/lib/firestore/tenant-write";

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
      { error: "Firebase Admin is not configured" },
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

  const ref = await db.collection(COLLECTIONS.ingestQueue).add(
    stampForCreate(parsed.data.organizationId, {
      type: "website_lead",
      payload: parsed.data,
      receivedAt: FieldValue.serverTimestamp(),
      status: "pending",
    }),
  );

  return NextResponse.json({ ok: true, id: ref.id });
}
