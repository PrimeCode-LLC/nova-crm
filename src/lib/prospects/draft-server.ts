import crypto from "node:crypto";
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from "@/lib/db/document-shim/shim-firestore";
import { z } from "zod";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stampForCreate, stampForUpdate } from "@/lib/documents/tenant-write";
import { resolveOwnerManagerIdsAdmin } from "@/lib/documents/resolve-owner-manager-ids-admin";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import {
  PROSPECT_DRAFT_FIELD_KEYS,
  applyReviewedDraftValues,
  draftCompletion,
  draftCompletionForForm,
  normalizeProspectDraftFieldValue,
  prospectFormFromDraft,
  prospectDraftValuesFromForm,
  type ProspectDraft,
  type ProspectDraftEvidence,
  type ProspectDraftField,
  type ProspectDraftFieldKey,
  type ProspectDraftOrigin,
  type ProspectDraftSourceSummary,
} from "@/lib/prospects/draft-types";
import { countCompanyProspectsForActor } from "@/lib/prospects/count-company-prospects-server";
import {
  buildProspectEntities,
  domainFromWebsiteOrEmail,
  normalizedEmail,
  parseProspectForm,
  validateProspectForm,
  type ProspectFormValues,
} from "@/lib/prospects/prospect-form";

const extractionSchema = z.object({
  fields: z
    .array(
      z.object({
        field: z.enum(PROSPECT_DRAFT_FIELD_KEYS),
        value: z.string().min(1).max(4000),
        confidence: z.number().min(0).max(1),
        quote: z.string().min(1).max(1000),
      }),
    )
    .max(40),
  companyIdentity: z
    .object({
      name: z.string().max(300).optional(),
      domain: z.string().max(300).optional(),
    })
    .nullable(),
  warnings: z.array(z.string().max(500)).max(10),
});

export type ProspectDraftSourceInput = {
  url: string;
  title: string;
  domain: string;
  text: string;
};

export type ProspectDraftFindingInput = {
  quality: {
    score: number;
    matchedSignalIds: string[];
    primaryOpportunityId?: string;
    primaryOpportunityLabel?: string;
  };
  strategy?: {
    strategyId: string;
    strategyName: string;
    strategyVersion: number;
    strategyAssignmentId: string;
    personaId?: string;
    score: number;
    selectionMode: "auto" | "manual";
  };
};

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function lockId(organizationId: string, userId: string): string {
  return crypto.createHash("sha256").update(`${organizationId}:${userId}`).digest("hex");
}

function stableEntityId(prefix: string, organizationId: string, draftId: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${organizationId}:${draftId}:${prefix}`)
    .digest("hex")
    .slice(0, 32);
  return `${prefix}-${digest}`;
}

function stableOperationId(prefix: string, ...parts: string[]): string {
  const digest = crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40);
  return `${prefix}-${digest}`;
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

function completionMetadata(
  fields: ProspectDraft["fields"],
  form?: ProspectFormValues,
): ReturnType<typeof draftCompletion> & { readiness: "ready" | "needs_review" } {
  const completion = draftCompletionForForm(fields, form);
  return {
    ...completion,
    readiness: completion.missingRequiredFields.length ? "needs_review" : "ready",
  };
}

export class ProspectDraftRevisionError extends Error {
  readonly code = "revision_conflict";

  constructor(readonly currentRevision: number) {
    super("This draft changed after it was loaded.");
    this.name = "ProspectDraftRevisionError";
  }
}

function revisionOf(raw: Record<string, unknown> | undefined): number {
  const revision = raw?.revision;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : 0;
}

function iso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizeCompanyIdentity(value: string): string {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(
      (part) =>
        part &&
        !["inc", "incorporated", "corp", "corporation", "llc", "ltd", "limited", "plc"].includes(
          part,
        ),
    )
    .join(" ");
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(withoutUndefined).filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto && proto !== Object.prototype) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, withoutUndefined(item)]),
    ) as T;
  }
  return value;
}

function serializeDraft(id: string, raw: Record<string, unknown>): ProspectDraft {
  const fields =
    (raw.fields as Partial<Record<ProspectDraftFieldKey, ProspectDraftField>> | undefined) ?? {};
  const form = parseProspectForm(raw.form) ?? undefined;
  const completion = completionMetadata(fields, form);
  const updatedAt = iso(raw.updatedAt);
  const sources = (raw.sources as ProspectDraftSourceSummary[] | undefined) ?? [];
  const sourceCount = Number(raw.sourceCount ?? sources.length);
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    userId: String(raw.userId ?? ""),
    revision: revisionOf(raw),
    status: (raw.status as ProspectDraft["status"]) ?? "active",
    origin:
      raw.origin === "manual" || raw.origin === "intent_radar"
        ? raw.origin
        : sourceCount > 0
          ? "intent_radar"
          : "manual",
    sourceContext:
      typeof raw.sourceContext === "string" ? raw.sourceContext : undefined,
    sourceReference:
      typeof raw.sourceReference === "string" ? raw.sourceReference : undefined,
    destination: typeof raw.destination === "string" ? raw.destination : undefined,
    fields,
    form,
    sources,
    sourceCount,
    qualityScore: typeof raw.qualityScore === "number" ? raw.qualityScore : undefined,
    qualityMatchedSignalIds: Array.isArray(raw.qualityMatchedSignalIds)
      ? (raw.qualityMatchedSignalIds as string[])
      : undefined,
    primaryOpportunityId:
      typeof raw.primaryOpportunityId === "string" ? raw.primaryOpportunityId : undefined,
    primaryOpportunityLabel:
      typeof raw.primaryOpportunityLabel === "string" ? raw.primaryOpportunityLabel : undefined,
    strategy:
      raw.strategy && typeof raw.strategy === "object"
        ? (raw.strategy as ProspectDraft["strategy"])
        : undefined,
    missingRequiredFields: completion.missingRequiredFields,
    completionPercent: completion.completionPercent,
    createdAt: iso(raw.createdAt),
    updatedAt,
    lastSavedAt: updatedAt,
    completedAt: raw.completedAt ? iso(raw.completedAt) : undefined,
    leadId: typeof raw.leadId === "string" ? raw.leadId : undefined,
    discardedAt: raw.discardedAt ? iso(raw.discardedAt) : undefined,
    discardReason: typeof raw.discardReason === "string" ? raw.discardReason : undefined,
  };
}

export async function getOrCreateWorkingDraft(input: {
  organizationId: string;
  userId: string;
}): Promise<{ draft: ProspectDraft; created: boolean }> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const lockRef = db.collection(COLLECTIONS.prospectDraftLocks).doc(
    lockId(input.organizationId, input.userId),
  );
  return db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef);
    const currentDraftId =
      lockSnap.exists && typeof lockSnap.data()?.draftId === "string"
        ? String(lockSnap.data()!.draftId)
        : undefined;
    if (currentDraftId) {
      const currentRef = db.collection(COLLECTIONS.prospectDrafts).doc(currentDraftId);
      const currentSnap = await tx.get(currentRef);
      if (
        currentSnap.exists &&
        currentSnap.data()?.organizationId === input.organizationId &&
        currentSnap.data()?.userId === input.userId &&
        currentSnap.data()?.status === "active"
      ) {
        return {
          draft: serializeDraft(currentSnap.id, currentSnap.data() as Record<string, unknown>),
          created: false,
        };
      }
    }

    const draftId = newId("pd");
    const draftRef = db.collection(COLLECTIONS.prospectDrafts).doc(draftId);
    const data = stampForCreate(
      input.organizationId,
      {
        userId: input.userId,
        status: "active",
        origin: "intent_radar",
        fields: {},
        sources: [],
        sourceCount: 0,
        revision: 0,
        missingRequiredFields: ["companyName", "contactName"],
        completionPercent: 0,
        readiness: "needs_review",
      },
      input.userId,
    );
    tx.create(draftRef, data);
    tx.set(
      lockRef,
      {
        organizationId: input.organizationId,
        userId: input.userId,
        draftId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return {
      draft: serializeDraft(draftId, {
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      created: true,
    };
  });
}

export async function getWorkingDraft(input: {
  organizationId: string;
  userId: string;
}): Promise<ProspectDraft | null> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const lockSnap = await db
    .collection(COLLECTIONS.prospectDraftLocks)
    .doc(lockId(input.organizationId, input.userId))
    .get();
  const draftId = lockSnap.data()?.draftId;
  if (typeof draftId !== "string") return null;
  const draft = await getProspectDraft({
    organizationId: input.organizationId,
    userId: input.userId,
    draftId,
  });
  return draft?.status === "active" ? draft : null;
}

export async function selectWorkingDraft(input: {
  organizationId: string;
  userId: string;
  draftId: string;
}): Promise<ProspectDraft | null> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const draftRef = db.collection(COLLECTIONS.prospectDrafts).doc(input.draftId);
  const lockRef = db
    .collection(COLLECTIONS.prospectDraftLocks)
    .doc(lockId(input.organizationId, input.userId));
  return db.runTransaction(async (tx) => {
    const draftSnap = await tx.get(draftRef);
    if (
      !draftSnap.exists ||
      draftSnap.data()?.organizationId !== input.organizationId ||
      draftSnap.data()?.userId !== input.userId ||
      draftSnap.data()?.status !== "active"
    ) {
      return null;
    }
    tx.set(
      lockRef,
      {
        organizationId: input.organizationId,
        userId: input.userId,
        draftId: input.draftId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return serializeDraft(draftSnap.id, draftSnap.data() as Record<string, unknown>);
  });
}

export async function createManualProspectDraft(input: {
  organizationId: string;
  userId: string;
  values?: Partial<Record<ProspectDraftFieldKey, string>>;
  form?: ProspectFormValues;
  origin?: ProspectDraftOrigin;
  sourceContext?: string;
  sourceReference?: string;
  destination?: string;
  idempotencyKey?: string;
}): Promise<ProspectDraft> {
  return createProspectDraft(input, false);
}

/** Create and select in one transaction so extension retries cannot orphan drafts. */
export async function createAndSelectWorkingDraft(input: {
  organizationId: string;
  userId: string;
  values?: Partial<Record<ProspectDraftFieldKey, string>>;
  form?: ProspectFormValues;
  origin?: ProspectDraftOrigin;
  sourceContext?: string;
  sourceReference?: string;
  destination?: string;
  idempotencyKey?: string;
}): Promise<ProspectDraft> {
  return createProspectDraft(input, true);
}

async function createProspectDraft(
  input: {
    organizationId: string;
    userId: string;
    values?: Partial<Record<ProspectDraftFieldKey, string>>;
    form?: ProspectFormValues;
    origin?: ProspectDraftOrigin;
    sourceContext?: string;
    sourceReference?: string;
    destination?: string;
    idempotencyKey?: string;
  },
  select: boolean,
): Promise<ProspectDraft> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const draftId = idempotencyKey
    ? stableOperationId("pd", input.organizationId, input.userId, "create", idempotencyKey)
    : newId("pd");
  const draftRef = db.collection(COLLECTIONS.prospectDrafts).doc(draftId);
  const lockRef = db.collection(COLLECTIONS.prospectDraftLocks).doc(
    lockId(input.organizationId, input.userId),
  );
  let fields = applyReviewedDraftValues({}, input.values ?? {});
  if (input.form) {
    fields = applyReviewedDraftValues(fields, prospectDraftValuesFromForm(input.form));
  }
  const completion = completionMetadata(fields, input.form);
  const data = stampForCreate(
    input.organizationId,
    {
      userId: input.userId,
      status: "active",
      origin: input.origin ?? "manual",
      ...(input.sourceContext ? { sourceContext: input.sourceContext } : {}),
      ...(input.sourceReference ? { sourceReference: input.sourceReference } : {}),
      ...(input.destination ? { destination: input.destination } : {}),
      revision: 0,
      fields,
      ...(input.form ? { form: withoutUndefined(input.form) } : {}),
      sources: [],
      sourceCount: 0,
      ...completion,
      ...(idempotencyKey ? { createIdempotencyKey: idempotencyKey } : {}),
    },
    input.userId,
  );
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(draftRef);
    if (existing.exists) {
      const raw = existing.data();
      if (
        !idempotencyKey ||
        raw?.organizationId !== input.organizationId ||
        raw?.userId !== input.userId ||
        raw?.createIdempotencyKey !== idempotencyKey
      ) {
        throw new Error("Draft idempotency key collision.");
      }
      if (select && raw?.status === "active") {
        tx.set(
          lockRef,
          {
            organizationId: input.organizationId,
            userId: input.userId,
            draftId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      return serializeDraft(existing.id, raw as Record<string, unknown>);
    }
    tx.create(draftRef, data);
    if (select) {
      tx.set(
        lockRef,
        {
          organizationId: input.organizationId,
          userId: input.userId,
          draftId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    return serializeDraft(draftId, {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
}

async function extractFields(input: {
  organizationId: string;
  userId: string;
  source: ProspectDraftSourceInput;
  currentFields: ProspectDraft["fields"];
}) {
  const result = await runAiStructuredFeature({
    organizationId: input.organizationId,
    userId: input.userId,
    feature: "prospect_draft_extract",
    schema: extractionSchema,
    promptVars: {
      sourceUrl: input.source.url,
      sourceTitle: input.source.title,
      sourceDomain: input.source.domain,
      currentFields: JSON.stringify(
        Object.fromEntries(
          Object.entries(input.currentFields).map(([key, field]) => [
            key,
            (field as ProspectDraftField).value,
          ]),
        ),
      ),
      pageText: input.source.text,
    },
  });
  return result.output;
}

function mergeExtractedFields(input: {
  fields: ProspectDraft["fields"];
  extracted: z.infer<typeof extractionSchema>["fields"];
  sourceId: string;
  source: ProspectDraftSourceInput;
}): { fields: ProspectDraft["fields"]; acceptedCount: number; rejectedCount: number } {
  const fields = { ...input.fields };
  const normalizedSource = normalizeText(input.source.text);
  let acceptedCount = 0;
  let rejectedCount = 0;
  for (const item of input.extracted) {
    const quote = item.quote.replace(/\s+/g, " ").trim();
    const normalizedValue = normalizeProspectDraftFieldValue(item.field, item.value);
    if (
      item.confidence < 0.8 ||
      quote.length < 2 ||
      !normalizedValue ||
      !normalizedSource.includes(normalizeText(quote))
    ) {
      rejectedCount += 1;
      continue;
    }
    const evidence: ProspectDraftEvidence = {
      sourceId: input.sourceId,
      sourceUrl: input.source.url,
      quote,
    };
    const current = fields[item.field];
    if (!current) {
      fields[item.field] = {
        value: normalizedValue,
        confidence: item.confidence,
        status: "proposed",
        evidence: [evidence],
        updatedAt: new Date().toISOString(),
      };
      acceptedCount += 1;
      continue;
    }
    if (normalizeText(current.value) === normalizeText(normalizedValue)) {
      fields[item.field] = {
        ...current,
        confidence: Math.max(current.confidence, item.confidence),
        evidence: [...current.evidence, evidence].slice(-10),
        updatedAt: new Date().toISOString(),
      };
      acceptedCount += 1;
      continue;
    }
    if (current.status === "verified" || current.status === "accepted") {
      fields[item.field] = {
        ...current,
        status: "conflict",
        alternatives: [
          ...(current.alternatives ?? []),
          { value: normalizedValue, confidence: item.confidence, evidence: [evidence] },
        ].slice(-5),
        updatedAt: new Date().toISOString(),
      };
      acceptedCount += 1;
      continue;
    }
    if (item.confidence > current.confidence) {
      fields[item.field] = {
        value: normalizedValue,
        confidence: item.confidence,
        status: "proposed",
        evidence: [evidence],
        alternatives: [
          ...(current.alternatives ?? []),
          { value: current.value, confidence: current.confidence, evidence: current.evidence },
        ].slice(-5),
        updatedAt: new Date().toISOString(),
      };
      acceptedCount += 1;
    }
  }
  return { fields, acceptedCount, rejectedCount };
}

export async function addSourceToWorkingDraft(input: {
  organizationId: string;
  userId: string;
  draftId?: string;
  source: ProspectDraftSourceInput;
  finding: ProspectDraftFindingInput;
  idempotencyKey?: string;
  expectedRevision?: number;
}): Promise<{
  draft: ProspectDraft;
  created: boolean;
  ai: { status: "completed" | "unavailable"; acceptedCount: number; rejectedCount: number };
  warnings: string[];
}> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const targetedDraft = input.draftId
    ? await getProspectDraft({
        organizationId: input.organizationId,
        userId: input.userId,
        draftId: input.draftId,
      })
    : null;
  if (input.draftId && targetedDraft?.status !== "active") {
    throw new Error("Active draft not found.");
  }
  const { draft, created } = targetedDraft
    ? { draft: targetedDraft, created: false }
    : await getOrCreateWorkingDraft({
        organizationId: input.organizationId,
        userId: input.userId,
      });
  const contentHash = crypto.createHash("sha256").update(input.source.text).digest("hex");
  const operationKey =
    normalizeIdempotencyKey(input.idempotencyKey) ??
    crypto
      .createHash("sha256")
      .update(`${input.source.url}\u0000${contentHash}`)
      .digest("hex");
  const sourceId = stableOperationId(
    "pds",
    input.organizationId,
    input.userId,
    draft.id,
    operationKey,
  );
  const sourceSummary: ProspectDraftSourceSummary = {
    id: sourceId,
    url: input.source.url,
    title: input.source.title,
    domain: input.source.domain,
    capturedAt: new Date().toISOString(),
  };
  const sourceRef = db.collection(COLLECTIONS.prospectDraftSources).doc(sourceId);
  try {
  let extracted: z.infer<typeof extractionSchema> | undefined;
  const warnings: string[] = [];
  try {
    extracted = await extractFields({
      organizationId: input.organizationId,
      userId: input.userId,
      source: input.source,
      currentFields: draft.fields,
    });
    warnings.push(...extracted.warnings);
  } catch (error) {
    warnings.push(
      error instanceof Error
        ? `AI extraction unavailable: ${error.message}`
        : "AI extraction is unavailable.",
    );
  }
  const extractedCompany = extracted?.fields.find(
    (field) =>
      field.field === "companyName" &&
      field.confidence >= 0.9 &&
      normalizeText(input.source.text).includes(normalizeText(field.quote)),
  );
  const currentCompany = draft.fields.companyName?.value;
  if (
    currentCompany &&
    extractedCompany &&
    normalizeCompanyIdentity(currentCompany) !== normalizeCompanyIdentity(extractedCompany.value)
  ) {
    throw new Error(
      `This source appears to be about ${extractedCompany.value}, but your working draft is for ${currentCompany}. Complete or discard that draft first.`,
    );
  }
  const draftRef = db.collection(COLLECTIONS.prospectDrafts).doc(draft.id);
  let mergeCounts = { acceptedCount: 0, rejectedCount: 0 };
  await db.runTransaction(async (tx) => {
    const [currentSnap, existingSourceSnap] = await Promise.all([
      tx.get(draftRef),
      tx.get(sourceRef),
    ]);
    if (!currentSnap.exists || currentSnap.data()?.status !== "active") {
      throw new Error("The working draft is no longer active.");
    }
    if (existingSourceSnap.exists) return;
    const currentRevision = revisionOf(currentSnap.data());
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== currentRevision
    ) {
      throw new ProspectDraftRevisionError(currentRevision);
    }
    const current = serializeDraft(
      currentSnap.id,
      currentSnap.data() as Record<string, unknown>,
    );
    const merged = mergeExtractedFields({
      fields: current.fields,
      extracted: extracted?.fields ?? [],
      sourceId,
      source: input.source,
    });
    mergeCounts = {
      acceptedCount: merged.acceptedCount,
      rejectedCount: merged.rejectedCount,
    };
    const completion = completionMetadata(merged.fields, current.form);
    const sources = [
      ...current.sources.filter((source) => source.url !== input.source.url),
      sourceSummary,
    ].slice(-30);
    tx.set(
      draftRef,
      stampForUpdate(
        {
          fields: merged.fields,
          sources,
          sourceCount: FieldValue.increment(1),
          revision: FieldValue.increment(1),
          ...completion,
          qualityScore: Math.max(current.qualityScore ?? 0, input.finding.quality.score),
          qualityMatchedSignalIds: Array.from(
            new Set([
              ...(current.qualityMatchedSignalIds ?? []),
              ...input.finding.quality.matchedSignalIds,
            ]),
          ),
          primaryOpportunityId:
            input.finding.quality.primaryOpportunityId ?? current.primaryOpportunityId ?? null,
          primaryOpportunityLabel:
            input.finding.quality.primaryOpportunityLabel ??
            current.primaryOpportunityLabel ??
            null,
          strategy: input.finding.strategy
            ? input.finding.strategy.selectionMode === "manual" ||
              !current.strategy ||
              current.strategy.selectionMode !== "manual" &&
                input.finding.strategy.score > current.strategy.score
              ? input.finding.strategy
              : current.strategy
            : current.strategy ?? null,
        },
        input.userId,
      ),
      { merge: true },
    );
    tx.create(
      sourceRef,
      stampForCreate(
        input.organizationId,
        {
          draftId: draft.id,
          userId: input.userId,
          ...sourceSummary,
          text: input.source.text,
          contentHash,
          idempotencyKey: operationKey,
        },
        input.userId,
      ),
    );
  });
  const updated = await draftRef.get();
  return {
    draft: serializeDraft(updated.id, updated.data() as Record<string, unknown>),
    created,
    ai: {
      status: extracted ? "completed" : "unavailable",
      acceptedCount: mergeCounts.acceptedCount,
      rejectedCount: mergeCounts.rejectedCount,
    },
    warnings,
  };
  } catch (error) {
    if (!created) throw error;
    const draftRef = db.collection(COLLECTIONS.prospectDrafts).doc(draft.id);
    const lockRef = db.collection(COLLECTIONS.prospectDraftLocks).doc(
      lockId(input.organizationId, input.userId),
    );
    await db
      .runTransaction(async (tx) => {
        const [draftSnap, lockSnap] = await Promise.all([
          tx.get(draftRef),
          tx.get(lockRef),
        ]);
        const raw = draftSnap.data();
        const fields =
          raw?.fields && typeof raw.fields === "object"
            ? Object.keys(raw.fields as Record<string, unknown>)
            : [];
        if (
          draftSnap.exists &&
          raw?.status === "active" &&
          Number(raw.sourceCount ?? 0) === 0 &&
          fields.length === 0
        ) {
          tx.delete(draftRef);
          if (lockSnap.data()?.draftId === draft.id) tx.delete(lockRef);
        }
      })
      .catch(() => undefined);
    throw error;
  }
}

export type ProspectDraftPage = {
  drafts: ProspectDraft[];
  nextCursor?: string;
};

type ProspectDraftCursor = {
  updatedAt: { seconds: number; nanoseconds: number };
  id: string;
};

export function encodeProspectDraftCursor(cursor: ProspectDraftCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProspectDraftCursor(value: string): ProspectDraftCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as ProspectDraftCursor).id !== "string" ||
      !(parsed as ProspectDraftCursor).updatedAt ||
      typeof (parsed as ProspectDraftCursor).updatedAt.seconds !== "number" ||
      typeof (parsed as ProspectDraftCursor).updatedAt.nanoseconds !== "number"
    ) {
      throw new Error("Invalid cursor.");
    }
    return parsed as ProspectDraftCursor;
  } catch {
    throw new Error("Invalid prospect draft cursor.");
  }
}

export async function listProspectDraftPage(input: {
  organizationId: string;
  userId?: string;
  status?: ProspectDraft["status"];
  origin?: ProspectDraftOrigin;
  readiness?: "ready" | "needs_review";
  search?: string;
  limit?: number;
  cursor?: string;
}): Promise<ProspectDraftPage> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 100);
  let query: Query<DocumentData> = db
    .collection(COLLECTIONS.prospectDrafts)
    .where("organizationId", "==", input.organizationId);
  if (input.userId) query = query.where("userId", "==", input.userId);
  if (input.status) query = query.where("status", "==", input.status);
  query = query.orderBy("updatedAt", "desc").orderBy(FieldPath.documentId(), "desc");
  let scanCursor = input.cursor ? decodeProspectDraftCursor(input.cursor) : undefined;
  const search = input.search?.trim().toLocaleLowerCase() ?? "";
  const matches: Array<{
    draft: ProspectDraft;
    doc: QueryDocumentSnapshot<DocumentData>;
  }> = [];
  const chunkSize = Math.min(Math.max(limit * 3, 50), 250);
  while (matches.length < limit + 1) {
    let pageQuery = query;
    if (scanCursor) {
      pageQuery = pageQuery.startAfter(
        new Timestamp(scanCursor.updatedAt.seconds, scanCursor.updatedAt.nanoseconds),
        scanCursor.id,
      );
    }
    const snap = await pageQuery.limit(chunkSize).get();
    for (const doc of snap.docs) {
      const draft = serializeDraft(doc.id, doc.data());
      if (input.origin && draft.origin !== input.origin) continue;
      const ready = draft.missingRequiredFields.length === 0;
      if (input.readiness === "ready" && !ready) continue;
      if (input.readiness === "needs_review" && ready) continue;
      if (search) {
        const values = [
          draft.fields.companyName?.value,
          draft.form?.bizName,
          draft.fields.contactName?.value,
          draft.form ? `${draft.form.firstName} ${draft.form.lastName}` : undefined,
          draft.fields.contactEmail?.value,
          draft.form?.email,
          draft.form?.personalEmail,
          draft.fields.companyDomain?.value,
          draft.form?.website,
          draft.sourceContext,
        ];
        if (!values.some((value) => value?.toLocaleLowerCase().includes(search))) continue;
      }
      matches.push({ draft, doc });
      if (matches.length >= limit + 1) break;
    }
    const scannedLast = snap.docs.at(-1);
    const scannedUpdatedAt = scannedLast?.data().updatedAt;
    if (
      matches.length >= limit + 1 ||
      snap.docs.length < chunkSize ||
      !scannedLast ||
      !(scannedUpdatedAt instanceof Timestamp)
    ) {
      break;
    }
    scanCursor = {
      id: scannedLast.id,
      updatedAt: {
        seconds: scannedUpdatedAt.seconds,
        nanoseconds: scannedUpdatedAt.nanoseconds,
      },
    };
  }
  const visible = matches.slice(0, limit).map(({ draft }) => draft);
  const last = matches.length > limit ? matches[limit - 1]?.doc : undefined;
  const lastUpdatedAt = last?.data().updatedAt;
  return {
    drafts: visible,
    nextCursor: last && lastUpdatedAt instanceof Timestamp
      ? encodeProspectDraftCursor({
          id: last.id,
          updatedAt: {
            seconds: lastUpdatedAt.seconds,
            nanoseconds: lastUpdatedAt.nanoseconds,
          },
        })
      : undefined,
  };
}

/** Legacy extension helper: keep returning a plain array. */
export async function listProspectDrafts(input: {
  organizationId: string;
  userId?: string;
  status?: ProspectDraft["status"];
}): Promise<ProspectDraft[]> {
  return (await listProspectDraftPage({ ...input, limit: 100 })).drafts;
}

export async function getProspectDraft(input: {
  organizationId: string;
  draftId: string;
  userId?: string;
}): Promise<ProspectDraft | null> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const snap = await db.collection(COLLECTIONS.prospectDrafts).doc(input.draftId).get();
  if (
    !snap.exists ||
    snap.data()?.organizationId !== input.organizationId ||
    (input.userId && snap.data()?.userId !== input.userId)
  ) {
    return null;
  }
  return serializeDraft(snap.id, snap.data() as Record<string, unknown>);
}

export async function updateProspectDraftFields(input: {
  organizationId: string;
  userId: string;
  draftId: string;
  values: Partial<Record<ProspectDraftFieldKey, string>>;
  form?: ProspectFormValues;
  expectedRevision?: number;
}): Promise<ProspectDraft | null> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const ref = db.collection(COLLECTIONS.prospectDrafts).doc(input.draftId);
  const changed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (
      !snap.exists ||
      snap.data()?.organizationId !== input.organizationId ||
      snap.data()?.userId !== input.userId ||
      snap.data()?.status !== "active"
    ) {
      return false;
    }
    const currentRevision = revisionOf(snap.data());
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== currentRevision
    ) {
      throw new ProspectDraftRevisionError(currentRevision);
    }
    const draft = serializeDraft(snap.id, snap.data() as Record<string, unknown>);
    let fields = applyReviewedDraftValues(draft.fields, input.values);
    if (input.form) {
      fields = applyReviewedDraftValues(fields, prospectDraftValuesFromForm(input.form));
    }
    const nextForm = input.form ?? draft.form;
    const completion = completionMetadata(fields, nextForm);
    tx.set(
      ref,
      stampForUpdate(
        {
          fields,
          ...(input.form ? { form: withoutUndefined(input.form) } : {}),
          revision: FieldValue.increment(1),
          ...completion,
        },
        input.userId,
      ),
      { merge: true },
    );
    return true;
  });
  if (!changed) return null;
  const updated = await ref.get();
  return serializeDraft(updated.id, updated.data() as Record<string, unknown>);
}

export async function discardProspectDraft(input: {
  organizationId: string;
  userId: string;
  draftId: string;
  reason: string;
  expectedRevision?: number;
}): Promise<boolean> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const ref = db.collection(COLLECTIONS.prospectDrafts).doc(input.draftId);
  const lockRef = db.collection(COLLECTIONS.prospectDraftLocks).doc(
    lockId(input.organizationId, input.userId),
  );
  return db.runTransaction(async (tx) => {
    const [draftSnap, lockSnap] = await Promise.all([tx.get(ref), tx.get(lockRef)]);
    if (
      !draftSnap.exists ||
      draftSnap.data()?.organizationId !== input.organizationId ||
      draftSnap.data()?.userId !== input.userId ||
      draftSnap.data()?.status !== "active"
    ) {
      return false;
    }
    const currentRevision = revisionOf(draftSnap.data());
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== currentRevision
    ) {
      throw new ProspectDraftRevisionError(currentRevision);
    }
    tx.set(
      ref,
      stampForUpdate(
        {
          status: "discarded",
          discardedAt: FieldValue.serverTimestamp(),
          discardReason: input.reason,
          revision: FieldValue.increment(1),
        },
        input.userId,
      ),
      { merge: true },
    );
    if (lockSnap.data()?.draftId === input.draftId) tx.delete(lockRef);
    return true;
  });
}

export async function completeProspectDraft(input: {
  organizationId: string;
  userId: string;
  draftId: string;
  allowIncomplete?: boolean;
  expectedRevision?: number;
}): Promise<{ leadId: string } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured." };
  const draft = await getProspectDraft({ ...input, userId: input.userId });
  if (draft?.status === "completed" && draft.leadId) {
    return { leadId: draft.leadId };
  }
  if (!draft || draft.status !== "active") {
    return { error: "Active draft not found." };
  }
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== draft.revision
  ) {
    throw new ProspectDraftRevisionError(draft.revision);
  }
  if (draft.missingRequiredFields.length) {
    return { error: `Complete required fields: ${draft.missingRequiredFields.join(", ")}.` };
  }
  {
    const form = prospectFormFromDraft(draft);
    const companyDomainForCount = domainFromWebsiteOrEmail(form.website, form.email)?.toLocaleLowerCase();
    const companyNameForCount = form.bizName.trim();
    const [organizationSnap, strategySnap, existingContactsForCompany] = await Promise.all([
      db.collection(COLLECTIONS.organizations).doc(input.organizationId).get(),
      form.strategyId
        ? db.collection(COLLECTIONS.prospectingStrategies).doc(form.strategyId).get()
        : Promise.resolve(null),
      countCompanyProspectsForActor({
        organizationId: input.organizationId,
        userId: input.userId,
        companyDomain: companyDomainForCount,
        companyName: companyNameForCount,
      }).catch(() => null),
    ]);
    if (existingContactsForCompany === null) {
      return { error: "Could not verify how many contacts this company already has." };
    }
    const organization = organizationSnap.data();
    const strategy = strategySnap?.data();
    if (
      form.strategyId &&
      (!strategySnap?.exists ||
        strategy?.organizationId !== input.organizationId ||
        !["published", "draft"].includes(String(strategy?.status ?? "")))
    ) {
      return { error: "Selected prospecting strategy is not available." };
    }
    const [assignmentSnap, personaSnap] = await Promise.all([
      form.strategyAssignmentId
        ? db.collection(COLLECTIONS.strategyAssignments).doc(form.strategyAssignmentId).get()
        : Promise.resolve(null),
      form.personaId
        ? db.collection(COLLECTIONS.buyerPersonas).doc(form.personaId).get()
        : Promise.resolve(null),
    ]);
    const assignment = assignmentSnap?.data();
    if (
      assignmentSnap &&
      (!assignmentSnap.exists ||
        assignment?.organizationId !== input.organizationId ||
        assignment?.userId !== input.userId ||
        assignment?.strategyId !== form.strategyId ||
        assignment?.status !== "active")
    ) {
      return { error: "Selected strategy assignment is not active for this user." };
    }
    const persona = personaSnap?.data();
    if (
      personaSnap &&
      (!personaSnap.exists ||
        persona?.organizationId !== input.organizationId ||
        persona?.active === false ||
        !Array.isArray(strategy?.personaIds) ||
        !strategy.personaIds.includes(form.personaId))
    ) {
      return { error: "Selected buyer persona is not available for this strategy." };
    }
    const outreachThreshold =
      typeof organization?.intentPlaybook?.outreachThreshold === "number"
        ? organization.intentPlaybook.outreachThreshold
        : 45;
    const maxContactsPerCompany =
      typeof strategy?.dailyTargets?.maxContactsPerCompany === "number"
        ? strategy.dailyTargets.maxContactsPerCompany
        : 2;
    const validation = validateProspectForm(form, {
      existingContactsForCompany,
      maxContactsPerCompany,
      outreachThreshold,
    });
    if (validation.errors.length) return { error: validation.errors[0]! };
    const submittedEmails = [normalizedEmail(form.email), normalizedEmail(form.personalEmail)].filter(
      Boolean,
    );
    if (submittedEmails.length) {
      const duplicateQueries = submittedEmails.flatMap((email) => [
        db.collection(COLLECTIONS.contacts).where("email", "==", email).limit(5).get(),
        db.collection(COLLECTIONS.contacts).where("personalEmail", "==", email).limit(5).get(),
      ]);
      const duplicateSnapshots = await Promise.all(duplicateQueries);
      const duplicate = duplicateSnapshots.some((snapshot) =>
        snapshot.docs.some((document) => document.data().organizationId === input.organizationId),
      );
      if (duplicate) return { error: "A contact with this email already exists." };
    }
    const blockingQualifyIssues = validation.qualifyIssues.filter((issue) => issue.blocking);
    if (
      form.qualifyForm.qualifyStatus === "completed" &&
      blockingQualifyIssues.length &&
      !input.allowIncomplete
    ) {
      return {
        error: `Qualification incomplete: ${blockingQualifyIssues.map((issue) => issue.message).join(" · ")}`,
      };
    }

    const now = new Date().toISOString();
    const accountId = stableEntityId("a", input.organizationId, draft.id);
    const contactId = stableEntityId("ct", input.organizationId, draft.id);
    const leadId = stableEntityId("l", input.organizationId, draft.id);
    const timelineEventId = stableEntityId("te", input.organizationId, draft.id);
    const entities = buildProspectEntities({
      form,
      accountId,
      contactId,
      leadId,
      ownerId: input.userId,
      now,
      qualifyAsIncomplete: input.allowIncomplete,
      research: {
        companyDomain: draft.fields.companyDomain?.value,
        businessFocus: draft.fields.businessFocus?.value,
        hiringSignals: draft.fields.hiringSignals?.value,
        recentNews: draft.fields.recentNews?.value,
      },
      quality: {
        score: draft.qualityScore,
        matchedSignalIds: draft.qualityMatchedSignalIds,
        primaryOpportunityId: draft.primaryOpportunityId,
      },
      extensions: {
        intentRadarDraft: {
          draftId: draft.id,
          sourceCount: draft.sourceCount,
          completedAt: now,
        },
      },
    });
    const ownerManagerIds = await resolveOwnerManagerIdsAdmin(db, input.userId);
    const account = withoutUndefined(stampForCreate(
      input.organizationId,
      {
        ...(entities.account as unknown as Record<string, unknown>),
        ownerManagerIds,
      },
      input.userId,
    ));
    const contact = withoutUndefined(stampForCreate(
      input.organizationId,
      {
        ...(entities.contact as unknown as Record<string, unknown>),
        ownerManagerIds,
      },
      input.userId,
    ));
    const lead = withoutUndefined(stampForCreate(
      input.organizationId,
      {
        ...(entities.lead as unknown as Record<string, unknown>),
        ownerManagerIds,
      },
      input.userId,
    ));
    const draftRef = db.collection(COLLECTIONS.prospectDrafts).doc(draft.id);
    const lockRef = db
      .collection(COLLECTIONS.prospectDraftLocks)
      .doc(lockId(input.organizationId, input.userId));
    const reservationCollection = db.collection(COLLECTIONS.prospectDraftReservations);
    const emailReservationRefs = submittedEmails.map((email) =>
      reservationCollection.doc(
        stableOperationId("email", input.organizationId, email),
      ),
    );
    const companyIdentity = companyDomainForCount
      ? `domain:${companyDomainForCount}`
      : `name:${normalizeCompanyIdentity(companyNameForCount)}`;
    const companyReservationRef = reservationCollection.doc(
      stableOperationId(
        "company",
        input.organizationId,
        input.userId,
        companyIdentity,
      ),
    );
    return db.runTransaction(async (tx) => {
      const [currentSnap, lockSnap, companyReservationSnap, ...emailReservationSnaps] =
        await Promise.all([
        tx.get(draftRef),
        tx.get(lockRef),
        tx.get(companyReservationRef),
        ...emailReservationRefs.map((ref) => tx.get(ref)),
      ]);
      const current = currentSnap.data();
      if (
        currentSnap.exists &&
        current?.organizationId === input.organizationId &&
        current?.userId === input.userId &&
        current?.status === "completed" &&
        typeof current.leadId === "string"
      ) {
        return { leadId: current.leadId };
      }
      if (
        !currentSnap.exists ||
        current?.organizationId !== input.organizationId ||
        current?.userId !== input.userId ||
        current?.status !== "active"
      ) {
        return { error: "Active draft not found." };
      }
      const currentRevision = revisionOf(current);
      if (currentRevision !== draft.revision) {
        throw new ProspectDraftRevisionError(currentRevision);
      }
      const conflictingEmail = emailReservationSnaps.some(
        (snapshot) => snapshot.exists && snapshot.data()?.draftId !== draft.id,
      );
      if (conflictingEmail) {
        return { error: "A contact with this email already exists." };
      }
      const reservedCompanyCount =
        typeof companyReservationSnap.data()?.count === "number"
          ? Number(companyReservationSnap.data()!.count)
          : 0;
      const effectiveCompanyCount = Math.max(
        existingContactsForCompany,
        reservedCompanyCount,
      );
      if (
        companyReservationSnap.data()?.draftIds?.includes?.(draft.id) !== true &&
        effectiveCompanyCount >= maxContactsPerCompany
      ) {
        return {
          error: `This company already has the maximum of ${maxContactsPerCompany} contacts for this owner.`,
        };
      }
      emailReservationRefs.forEach((ref) => {
        tx.set(
          ref,
          {
            organizationId: input.organizationId,
            kind: "email",
            valueHash: ref.id,
            draftId: draft.id,
            contactId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });
      const priorDraftIds = Array.isArray(companyReservationSnap.data()?.draftIds)
        ? (companyReservationSnap.data()!.draftIds as string[])
        : [];
      const nextDraftIds = priorDraftIds.includes(draft.id)
        ? priorDraftIds
        : [...priorDraftIds, draft.id];
      tx.set(
        companyReservationRef,
        {
          organizationId: input.organizationId,
          userId: input.userId,
          kind: "company_contact_limit",
          companyIdentity,
          count: priorDraftIds.includes(draft.id)
            ? effectiveCompanyCount
            : effectiveCompanyCount + 1,
          draftIds: nextDraftIds.slice(-Math.max(maxContactsPerCompany, 10)),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.create(db.collection(COLLECTIONS.accounts).doc(accountId), account);
      tx.create(db.collection(COLLECTIONS.contacts).doc(contactId), contact);
      tx.create(db.collection(COLLECTIONS.leads).doc(leadId), lead);
      tx.create(db.collection(COLLECTIONS.timelineEvents).doc(timelineEventId), {
        organizationId: input.organizationId,
        leadId,
        leadOwnerId: input.userId,
        leadOwnerManagerIds: ownerManagerIds,
        type: "lead_created",
        actorId: input.userId,
        summary: `Prospect created from working draft for ${form.channel.replaceAll("_", " ")}.`,
        payload: { source: "intent_radar_draft", draftId: draft.id },
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        draftRef,
        stampForUpdate(
          {
            status: "completed",
            completedAt: FieldValue.serverTimestamp(),
            leadId,
            revision: FieldValue.increment(1),
          },
          input.userId,
        ),
        { merge: true },
      );
      if (lockSnap.data()?.draftId === draft.id) tx.delete(lockRef);
      return { leadId };
    });
  }
}
