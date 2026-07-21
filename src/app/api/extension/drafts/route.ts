import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { extensionOptionsResponse, guardExtensionApi } from "@/lib/extension/auth-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  addSourceToWorkingDraft,
  completeProspectDraft,
  createAndSelectWorkingDraft,
  discardProspectDraft,
  getWorkingDraft,
  listProspectDrafts,
  selectWorkingDraft,
  updateProspectDraftFields,
  ProspectDraftRevisionError,
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
  draftId: z.string().min(1).max(160).optional(),
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
  revision: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

const updateSchema = z.object({
  draftId: z.string().min(1).max(160).optional(),
  values: z.partialRecord(z.enum(PROSPECT_DRAFT_FIELD_KEYS), z.string().max(4000)),
  revision: z.number().int().nonnegative().optional(),
});

const draftActionSchema = z.object({
  draftId: z.string().min(1).max(160).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  revision: z.number().int().nonnegative().optional(),
});

const selectDraftSchema = z.object({
  operation: z.literal("select"),
  draftId: z.string().min(1).max(160),
});

const newDraftSchema = z.object({
  operation: z.literal("new-draft"),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

function revisionConflictResponse(error: ProspectDraftRevisionError, headers: HeadersInit) {
  return Response.json(
    { error: error.message, code: error.code, currentRevision: error.currentRevision },
    { status: 409, headers },
  );
}

export function OPTIONS(req: Request) {
  return extensionOptionsResponse(req);
}

export async function GET(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  const url = new URL(req.url);
  if (url.searchParams.get("operation") === "list") {
    const { organizationId, uid } = guarded.principal;
    const [drafts, selectedDraft] = await Promise.all([
      listProspectDrafts({
        organizationId,
        userId: uid,
        status: "active",
      }),
      getWorkingDraft({ organizationId, userId: uid }),
    ]);
    return Response.json(
      { drafts, selectedDraftId: selectedDraft?.id ?? null },
      { headers: guarded.headers },
    );
  }
  const draft = await getWorkingDraft({
    organizationId: guarded.principal.organizationId,
    userId: guarded.principal.uid,
  });
  return Response.json({ draft }, { headers: guarded.headers });
}

export async function POST(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  const rawBody = await req.json().catch(() => null);
  const operation =
    rawBody && typeof rawBody === "object" && "operation" in rawBody
      ? (rawBody as { operation?: unknown }).operation
      : undefined;
  const { organizationId, uid } = guarded.principal;
  if (operation === "select") {
    const parsed = selectDraftSchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.flatten() },
        { status: 400, headers: guarded.headers },
      );
    }
    const draft = await selectWorkingDraft({
      organizationId,
      userId: uid,
      draftId: parsed.data.draftId,
    });
    if (!draft) {
      return Response.json(
        { error: "Active draft not found." },
        { status: 404, headers: guarded.headers },
      );
    }
    return Response.json({ draft }, { headers: guarded.headers });
  }
  if (operation === "new-draft") {
    const parsed = newDraftSchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.flatten() },
        { status: 400, headers: guarded.headers },
      );
    }
    const draft = await createAndSelectWorkingDraft({
      organizationId,
      userId: uid,
      origin: "intent_radar",
      sourceContext: "intent_radar_extension",
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return Response.json({ draft }, { status: 201, headers: guarded.headers });
  }
  const parsed = bodySchema.safeParse(rawBody);
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
      draftId: parsed.data.draftId,
      source: parsed.data.page,
      finding: {
        quality: parsed.data.quality,
        strategy,
      },
      idempotencyKey: parsed.data.idempotencyKey,
      expectedRevision: parsed.data.revision,
    });
    const findingId = crypto
      .createHash("sha256")
      .update(
        [
          organizationId,
          uid,
          result.draft.id,
          parsed.data.idempotencyKey ?? "",
          parsed.data.page.url,
          crypto.createHash("sha256").update(parsed.data.page.text).digest("hex"),
        ].join("\u0000"),
      )
      .digest("hex");
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
    if (error instanceof ProspectDraftRevisionError) {
      return revisionConflictResponse(error, guarded.headers);
    }
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
  const draftId =
    parsed.data.draftId ??
    (
      await getWorkingDraft({
        organizationId: guarded.principal.organizationId,
        userId: guarded.principal.uid,
      })
    )?.id;
  let draft;
  try {
    draft = draftId ? await updateProspectDraftFields({
      organizationId: guarded.principal.organizationId,
      userId: guarded.principal.uid,
      draftId,
      values: parsed.data.values,
      expectedRevision: parsed.data.revision,
    }) : null;
  } catch (error) {
    if (error instanceof ProspectDraftRevisionError) {
      return revisionConflictResponse(error, guarded.headers);
    }
    throw error;
  }
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
  const draftId =
    parsed.data.draftId ??
    (
      await getWorkingDraft({
        organizationId: guarded.principal.organizationId,
        userId: guarded.principal.uid,
      })
    )?.id;
  if (!draftId) {
    return Response.json(
      { error: "Active draft not found." },
      { status: 400, headers: guarded.headers },
    );
  }
  let result;
  try {
    result = await completeProspectDraft({
      organizationId: guarded.principal.organizationId,
      userId: guarded.principal.uid,
      draftId,
      expectedRevision: parsed.data.revision,
    });
  } catch (error) {
    if (error instanceof ProspectDraftRevisionError) {
      return revisionConflictResponse(error, guarded.headers);
    }
    throw error;
  }
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
  const draftId =
    parsed.data.draftId ??
    (
      await getWorkingDraft({
        organizationId: guarded.principal.organizationId,
        userId: guarded.principal.uid,
      })
    )?.id;
  let discarded;
  try {
    discarded = draftId ? await discardProspectDraft({
      organizationId: guarded.principal.organizationId,
      userId: guarded.principal.uid,
      draftId,
      reason: parsed.data.reason,
      expectedRevision: parsed.data.revision,
    }) : false;
  } catch (error) {
    if (error instanceof ProspectDraftRevisionError) {
      return revisionConflictResponse(error, guarded.headers);
    }
    throw error;
  }
  if (!discarded) {
    return Response.json(
      { error: "Active draft not found." },
      { status: 404, headers: guarded.headers },
    );
  }
  return Response.json({ ok: true }, { headers: guarded.headers });
}
