import { NextResponse } from "next/server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { indexAiDocumentServer } from "@/lib/ai/rag-indexer";
import { getAiProviderKeyFlagsServer } from "@/lib/ai/ai-secrets-server";

export async function POST() {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const keyFlags = await getAiProviderKeyFlagsServer(orgId);
  if (!keyFlags.openai && !keyFlags.anthropic && !keyFlags.google) {
    return NextResponse.json(
      {
        error:
          "No AI provider API key saved for this org. Add an OpenAI key under Setup, then re-index.",
      },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .get();

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const doc of snap.docs) {
    const result = await indexAiDocumentServer({
      organizationId: orgId,
      documentId: doc.id,
      userId: g.ctx.session.uid,
    });
    if ("error" in result) {
      failed += 1;
      if (errors.length < 10) errors.push(`${doc.id}: ${result.error}`);
    } else {
      ok += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    total: snap.size,
    indexed: ok,
    failed,
    errors,
  });
}
