import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { extensionOptionsResponse, guardExtensionApi } from "@/lib/extension/auth-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  addSourceToWorkingDraft,
  completeProspectDraft,
  discardProspectDraft,
  listProspectDrafts,
  updateProspectDraftFields,
} from "@/lib/prospects/draft-server";
import { recordAudit } from "@/lib/firestore/audit";
import { PROSPECT_DRAFT_FIELD_KEYS } from "@/lib/prospects/draft-types";
import {
  StrategyAttributionError,
  validateExtensionStrategyAttribution,
} from "@/lib/extension/strategy-attribution-server";

const strategySchema = z.object({
  strategyId: z.string().min(1).max(160),
  strategyName: z.string().min(1).max(200),
  strategyVersion: z.number().int().min(1),
  strategyAssignmentId: z.string().min(1).max(160),
  personaId: z.string().max(160).optional(),
  score: z.number().min(0).max(100),
  selectionMode: z.enum(["auto", "manual"]),
});

const bodySchema = z.object({
  page: z.object({
    url: z.string().url().max(4000),
    title: z.string().max(500),
    text: z.string().min(1).max(50000),
    domain: z.string().max(300),
  }),
  quality: z.object({
    score: z.number().min(0).max(100),
    matchedSignalIds: z.array(z.string().max(160)).max(100),
    primaryOpportunityId: z.string().max(160).optional(),
    primaryOpportunityLabel: z.string().max(200).optional(),
  }),
  strategy: strategySchema.optional(),
});

const updateSchema = z.object({
  draftId: z.string().min(1).max(160),
  values: z.partialRecord(z.enum(PROSPECT_DRAFT_FIELD_KEYS), z.string().max(4000)),
});

const draftActionSchema = z.object({
  draftId: z.string().min(1).max(160),
  reason: z.string().trim().min(1).max(500).optional(),
});

export function OPTIONS(req: Request) {
  return extensionOptionsResponse(req);
}

export async function GET(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  const drafts = await listProspectDrafts({
    organizationId: guarded.principal.organizationId,
    userId: guarded.principal.uid,
    status: "active",
  });
  return Response.json({ draft: drafts[0] ?? null }, { headers: guarded.headers });
}

export async function POST(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: guarded.headers },
    );
  }
  const db = getAdminDb();
  if (!db) {
    return Response.json(
      { error: "Database not configured." },
      { status: 503, headers: guarded.headers },
    );
  }
  const { organizationId, uid } = guarded.principal;
  try {
    const strategy = await validateExtensionStrategyAttribution({
      db,
      organizationId,
      userId: uid,
      strategy: parsed.data.strategy,
    });
    const result = await addSourceToWorkingDraft({
      organizationId,
      userId: uid,
      source: parsed.data.page,
      finding: {
        quality: parsed.data.quality,
        strategy,
      },
    });
    const findingId = crypto.randomUUID();
    await db.collection(COLLECTIONS.extensionFindings).doc(findingId).set({
      organizationId,
      userId: uid,
      action: "draft",
      draftId: result.draft.id,
      page: {
        url: parsed.data.page.url,
        title: parsed.data.page.title,
        domain: parsed.data.page.domain,
      },
      quality: parsed.data.quality,
      strategy: strategy ?? null,
      ai: result.ai,
      createdAt: FieldValue.serverTimestamp(),
    });
    void recordAudit({
      organizationId,
      actorUid: uid,
      actorEmail: guarded.principal.email,
      event: "extension.finding_saved",
      meta: {
        findingId,
        action: "draft",
        draftId: result.draft.id,
        url: parsed.data.page.url,
        strategyId: strategy?.strategyId,
      },
    });
    return Response.json(
      { ok: true, findingId, ...result },
      { headers: guarded.headers },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update working draft." },
      {
        status: error instanceof StrategyAttributionError ? 400 : 500,
        headers: guarded.headers,
      },
    );
  }
}

export async function PATCH(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: guarded.headers },
    );
  }
  const draft = await updateProspectDraftFields({
    organizationId: guarded.principal.organizationId,
    userId: guarded.principal.uid,
    draftId: parsed.data.draftId,
    values: parsed.data.values,
  });
  if (!draft) {
    return Response.json(
      { error: "Active draft not found." },
      { status: 404, headers: guarded.headers },
    );
  }
  return Response.json({ draft }, { headers: guarded.headers });
}

export async function PUT(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  const parsed = draftActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: guarded.headers },
    );
  }
  const result = await completeProspectDraft({
    organizationId: guarded.principal.organizationId,
    userId: guarded.principal.uid,
    draftId: parsed.data.draftId,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400, headers: guarded.headers });
  }
  return Response.json({ ok: true, leadId: result.leadId }, { headers: guarded.headers });
}

export async function DELETE(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  const parsed = draftActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parsed.data.reason) {
    return Response.json(
      { error: "A discard reason is required." },
      { status: 400, headers: guarded.headers },
    );
  }
  const discarded = await discardProspectDraft({
    organizationId: guarded.principal.organizationId,
    userId: guarded.principal.uid,
    draftId: parsed.data.draftId,
    reason: parsed.data.reason,
  });
  if (!discarded) {
    return Response.json(
      { error: "Active draft not found." },
      { status: 404, headers: guarded.headers },
    );
  }
  return Response.json({ ok: true }, { headers: guarded.headers });
}
