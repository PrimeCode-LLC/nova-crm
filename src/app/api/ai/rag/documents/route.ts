import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { indexAiDocumentServer } from "@/lib/ai/rag-indexer";
import { recordAudit } from "@/lib/firestore/audit";

export async function GET(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const libraryId = new URL(req.url).searchParams.get("libraryId");
  const db = getAdminDb();
  if (!db) return NextResponse.json({ documents: [] });

  const col = db
    .collection(COLLECTIONS.organizations)
    .doc(g.ctx.session.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments);

  const snap = libraryId
    ? await col.where("libraryId", "==", libraryId).limit(100).get()
    : await col.limit(100).get();
  return NextResponse.json({
    documents: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
  });
}

const createSchema = z.object({
  libraryId: z.string().min(1),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(200_000),
  sourceType: z.enum(["markdown", "script", "upload"]).default("markdown"),
  sourceRef: z.string().optional(),
  knowledgeSection: z
    .enum(["icp", "services", "pricing", "case_studies", "playbook", "website", "other"])
    .optional(),
  indexNow: z.boolean().optional(),
});

export async function POST(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
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
  const now = new Date().toISOString();
  const ref = db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .doc();

  await ref.set({
    libraryId: parsed.data.libraryId,
    title: parsed.data.title,
    content: parsed.data.content,
    sourceType: parsed.data.sourceType,
    sourceRef: parsed.data.sourceRef ?? null,
    knowledgeSection: parsed.data.knowledgeSection ?? null,
    chunkCount: 0,
    organizationId: orgId,
    createdAt: now,
    updatedAt: now,
  });

  const libRef = db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .doc(parsed.data.libraryId);
  const libSnap = await libRef.get();
  const prevCount = (libSnap.data()?.documentCount as number | undefined) ?? 0;
  await libRef.set({ documentCount: prevCount + 1, updatedAt: now }, { merge: true });

  if (parsed.data.indexNow !== false) {
    await indexAiDocumentServer({
      organizationId: orgId,
      documentId: ref.id,
      userId: g.ctx.session.uid,
    });
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "ai.library_indexed",
    meta: { documentId: ref.id, libraryId: parsed.data.libraryId },
  });

  return NextResponse.json({ documentId: ref.id });
}
