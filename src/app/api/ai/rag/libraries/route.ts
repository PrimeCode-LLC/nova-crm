import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import type { AiKnowledgeLibrary, AiLibraryAllowedFeature, AiLibraryScope } from "@/lib/ai/types";
import { defaultAllowedFeaturesForLibraryType } from "@/lib/ai/knowledge-library-ui";

export async function GET() {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) return NextResponse.json({ libraries: [] });

  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(g.ctx.session.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .get();

  const libraries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ libraries });
}

const featureSchema = z.enum([
  "content",
  "outreach",
  "fit_check",
  "intent_radar",
  "lead_ai",
]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  allowedFeatures: z.array(featureSchema).min(1).max(10).optional(),
  scope: z.object({
    type: z.enum(["org", "channel", "profile", "campaign"]),
    channelKey: z.string().optional(),
    profileId: z.string().optional(),
    campaignId: z.string().optional(),
  }),
});

export async function POST(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const orgId = g.ctx.session.organizationId;
  const scope = parsed.data.scope as AiLibraryScope;
  const now = new Date().toISOString();
  const ref = db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .doc();

  const allowedFeatures: AiLibraryAllowedFeature[] =
    parsed.data.allowedFeatures ?? defaultAllowedFeaturesForLibraryType("topic");

  const lib: AiKnowledgeLibrary = {
    id: ref.id,
    organizationId: orgId,
    name: parsed.data.name,
    ...(parsed.data.description != null && parsed.data.description !== ""
      ? { description: parsed.data.description }
      : {}),
    scope,
    documentCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
    allowedFeatures,
  };

  await ref.set(lib);
  return NextResponse.json({ library: lib });
}
