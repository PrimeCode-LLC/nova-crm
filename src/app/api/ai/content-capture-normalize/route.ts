import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { indexAiDocumentServer } from "@/lib/ai/rag-indexer";
import {
  ensureContentBrandLibraryServer,
  formatBrandContextForPrompt,
  getContentBrandServer,
} from "@/lib/ai/content-knowledge-server";
import { getFitCheckKnowledgeConfigServer } from "@/lib/ai/fit-check-knowledge";
import type { Role } from "@/lib/types";

const bodySchema = z.object({
  captureId: z.string().min(1),
});

const normalizeSchema = z.object({
  title: z.string().min(1).max(200),
  markdown: z.string().min(1).max(50_000),
  tags: z.array(z.string().max(40)).max(20),
  summary: z.string().max(500),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const userSnap = await db.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "content_capture_normalize", roleId)) {
    return NextResponse.json(
      { error: "Content capture AI is not enabled for your role." },
      { status: 403 },
    );
  }

  const captureRef = db.collection(COLLECTIONS.contentCaptures).doc(parsed.data.captureId);
  const captureSnap = await captureRef.get();
  if (!captureSnap.exists || captureSnap.data()?.organizationId !== orgId) {
    return NextResponse.json({ error: "Capture not found" }, { status: 404 });
  }

  const capture = captureSnap.data()!;
  const brandId = typeof capture.brandId === "string" ? capture.brandId : undefined;
  const brand = brandId ? await getContentBrandServer(orgId, brandId) : null;

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "content_capture_normalize",
      schema: normalizeSchema,
      promptVars: {
        brandContext: brand ? formatBrandContextForPrompt(brand) : "No brand selected — company knowledge base.",
        publicSafe: String(Boolean(capture.publicSafe)),
        problem: String(capture.problem ?? ""),
        solution: String(capture.solution ?? ""),
        outcome: String(capture.outcome ?? ""),
        notes: String(capture.notes ?? ""),
      },
    });

    let libraryId: string | undefined;
    if (brand) {
      libraryId = await ensureContentBrandLibraryServer({
        organizationId: orgId,
        brandId: brand.id,
        brandName: brand.name,
      });
      if (!brand.knowledgeLibraryIds?.includes(libraryId)) {
        await db
          .collection(COLLECTIONS.contentBrands)
          .doc(brand.id)
          .update({
            knowledgeLibraryIds: FieldValue.arrayUnion(libraryId),
            updatedAt: new Date().toISOString(),
          });
      }
    } else {
      const knowledge = await getFitCheckKnowledgeConfigServer(orgId);
      libraryId = knowledge.globalLibraryId;
    }

    if (!libraryId) {
      await captureRef.update({
        status: "failed",
        errorMessage: "No knowledge library available. Link a library on the brand or seed Fit Check knowledge.",
        normalizedTitle: result.title,
        normalizedMarkdown: result.markdown,
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json(
        { error: "No knowledge library available to index into." },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const docRef = db
      .collection(COLLECTIONS.organizations)
      .doc(orgId)
      .collection(ORG_SUBCOLLECTIONS.aiDocuments)
      .doc();

    const section = capture.publicSafe ? "case_studies" : "other";
    await docRef.set({
      libraryId,
      title: result.title,
      content: result.markdown,
      sourceType: "markdown",
      sourceRef: `contentCapture:${parsed.data.captureId}`,
      knowledgeSection: section,
      chunkCount: 0,
      organizationId: orgId,
      publicSafe: Boolean(capture.publicSafe),
      createdAt: now,
      updatedAt: now,
    });

    const indexed = await indexAiDocumentServer({
      organizationId: orgId,
      documentId: docRef.id,
      userId: uid,
    });

    if ("error" in indexed) {
      await captureRef.update({
        status: "failed",
        errorMessage: indexed.error,
        normalizedTitle: result.title,
        normalizedMarkdown: result.markdown,
        knowledgeDocumentId: docRef.id,
        libraryId,
        updatedAt: now,
      });
      return NextResponse.json({ error: indexed.error }, { status: 500 });
    }

    await captureRef.update({
      status: "indexed",
      normalizedTitle: result.title,
      normalizedMarkdown: result.markdown,
      knowledgeDocumentId: docRef.id,
      libraryId,
      errorMessage: FieldValue.delete(),
      updatedAt: now,
    });

    return NextResponse.json({
      title: result.title,
      summary: result.summary,
      tags: result.tags,
      documentId: docRef.id,
      libraryId,
      chunkCount: indexed.chunkCount,
    });
  } catch (e) {
    await captureRef.update({
      status: "failed",
      errorMessage: e instanceof Error ? e.message : "AI failed",
      updatedAt: new Date().toISOString(),
    });
    return aiErrorResponse(e);
  }
}
