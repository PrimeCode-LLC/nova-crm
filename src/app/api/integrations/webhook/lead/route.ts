import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

const bodySchema = z.object({
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
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "INBOUND_WEBHOOK_SECRET is not configured" },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");
  const headerSecret = req.headers.get("x-webhook-secret");
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : headerSecret;
  if (token !== secret) {
    return unauthorized();
  }

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

  const ref = await db.collection("ingestQueue").add({
    type: "website_lead",
    payload: parsed.data,
    receivedAt: FieldValue.serverTimestamp(),
    status: "pending",
  });

  return NextResponse.json({ ok: true, id: ref.id });
}
