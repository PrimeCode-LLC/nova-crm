import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  deleteAiDocumentServer,
  deleteAiDocumentsBySourceRefServer,
} from "@/lib/ai/delete-ai-document-server";

type RouteCtx = { params: Promise<{ captureId: string }> };

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const { captureId } = await ctx.params;
  if (!captureId) {
    return NextResponse.json({ error: "Missing capture id" }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const captureRef = db.collection(COLLECTIONS.contentCaptures).doc(captureId);
  const snap = await captureRef.get();
  if (!snap.exists || snap.data()?.organizationId !== orgId) {
    return NextResponse.json({ error: "Capture not found" }, { status: 404 });
  }

  const data = snap.data()!;
  const knowledgeDocumentId =
    typeof data.knowledgeDocumentId === "string" ? data.knowledgeDocumentId : undefined;

  if (knowledgeDocumentId) {
    const deleted = await deleteAiDocumentServer({
      organizationId: orgId,
      documentId: knowledgeDocumentId,
    });
    if ("error" in deleted) {
      return NextResponse.json({ error: deleted.error }, { status: 503 });
    }
  }

  // Sweep any orphan docs tied by sourceRef (e.g. partial index failures).
  await deleteAiDocumentsBySourceRefServer({
    organizationId: orgId,
    sourceRef: `contentCapture:${captureId}`,
  });

  await captureRef.delete();
  return NextResponse.json({ ok: true });
}
