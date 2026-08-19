import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { UserAiPreferences } from "@/lib/ai/types";

const patchSchema = z
  .object({
    tone: z.enum(["professional", "friendly", "concise"]).optional(),
    extraInstructions: z.string().max(2000).optional(),
    saveAnalysisToTimeline: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) return NextResponse.json({ preferences: {} });

  const snap = await db.collection(COLLECTIONS.users).doc(g.ctx.session.uid).get();
  const prefs = (snap.data()?.aiPreferences ?? {}) as UserAiPreferences;
  return NextResponse.json({ preferences: prefs });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
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

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const ref = db.collection(COLLECTIONS.users).doc(g.ctx.session.uid);
  const snap = await ref.get();
  const prev = (snap.data()?.aiPreferences ?? {}) as UserAiPreferences;
  const next = { ...prev, ...parsed.data };

  await ref.set({ aiPreferences: next }, { merge: true });
  return NextResponse.json({ preferences: next });
}
