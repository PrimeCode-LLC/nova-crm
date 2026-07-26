import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { indexAiDocumentServer } from "@/lib/ai/rag-indexer";
import { deleteAiDocumentServer } from "@/lib/ai/delete-ai-document-server";
import { KNOWLEDGE_SECTIONS } from "@/lib/ai/fit-check-knowledge-types";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(200_000).optional(),
  knowledgeSection: z.enum(KNOWLEDGE_SECTIONS).optional(),
  indexNow: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ documentId: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const { documentId } = await ctx.params;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const ref = db
    .collection(COLLECTIONS.organizations)
    .doc(g.ctx.session.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .doc(documentId);

  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ document: { id: snap.id, ...snap.data() } });
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const { documentId } = await ctx.params;
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

  const orgId = g.ctx.session.organizationId;
  const ref = db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .doc(documentId);

  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;
  if (parsed.data.knowledgeSection !== undefined) {
    updates.knowledgeSection = parsed.data.knowledgeSection;
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await ref.update(updates);

  if (parsed.data.indexNow !== false) {
    const indexed = await indexAiDocumentServer({
      organizationId: orgId,
      documentId,
      userId: g.ctx.session.uid,
    });
    if ("error" in indexed) {
      return NextResponse.json({ error: indexed.error }, { status: 500 });
    }
  }

  const updated = await ref.get();
  return NextResponse.json({ document: { id: updated.id, ...updated.data() } });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const { documentId } = await ctx.params;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const orgId = g.ctx.session.organizationId;
  const ref = db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .doc(documentId);

  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const deleted = await deleteAiDocumentServer({
    organizationId: orgId,
    documentId,
  });
  if ("error" in deleted) {
    return NextResponse.json({ error: deleted.error }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
