import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import {
  PROSPECT_DRAFT_FIELD_KEYS,
  draftCompletion,
  normalizeProspectDraftFieldValue,
  type ProspectDraft,
  type ProspectDraftEvidence,
  type ProspectDraftField,
  type ProspectDraftFieldKey,
  type ProspectDraftSourceSummary,
} from "@/lib/prospects/draft-types";

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
  const completion = draftCompletion(fields);
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    userId: String(raw.userId ?? ""),
    status: (raw.status as ProspectDraft["status"]) ?? "active",
    fields,
    sources: (raw.sources as ProspectDraftSourceSummary[] | undefined) ?? [],
    sourceCount: Number(raw.sourceCount ?? 0),
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
    ...completion,
    createdAt: iso(raw.createdAt),
    updatedAt: iso(raw.updatedAt),
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
        fields: {},
        sources: [],
        sourceCount: 0,
        missingRequiredFields: ["companyName", "contactName"],
        completionPercent: 0,
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

async function extractFields(input: {
  organizationId: string;
  userId: string;
  source: ProspectDraftSourceInput;
  currentFields: ProspectDraft["fields"];
}) {
  return runAiStructuredFeature({
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
  source: ProspectDraftSourceInput;
  finding: ProspectDraftFindingInput;
}): Promise<{
  draft: ProspectDraft;
  created: boolean;
  ai: { status: "completed" | "unavailable"; acceptedCount: number; rejectedCount: number };
  warnings: string[];
}> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const { draft, created } = await getOrCreateWorkingDraft(input);
  const sourceId = newId("pds");
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
  await sourceRef.set(
    stampForCreate(
      input.organizationId,
      {
        draftId: draft.id,
        userId: input.userId,
        ...sourceSummary,
        text: input.source.text,
        contentHash: crypto.createHash("sha256").update(input.source.text).digest("hex"),
      },
      input.userId,
    ),
  );
  const draftRef = db.collection(COLLECTIONS.prospectDrafts).doc(draft.id);
  let mergeCounts = { acceptedCount: 0, rejectedCount: 0 };
  await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(draftRef);
    if (!currentSnap.exists || currentSnap.data()?.status !== "active") {
      throw new Error("The working draft is no longer active.");
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
    const completion = draftCompletion(merged.fields);
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
    await sourceRef.delete().catch(() => undefined);
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

export async function listProspectDrafts(input: {
  organizationId: string;
  userId?: string;
  status?: ProspectDraft["status"];
}): Promise<ProspectDraft[]> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const query = db
    .collection(COLLECTIONS.prospectDrafts)
    .where("organizationId", "==", input.organizationId);
  const snap = await query.limit(100).get();
  return snap.docs
    .map((doc) => serializeDraft(doc.id, doc.data()))
    .filter((draft) => !input.userId || draft.userId === input.userId)
    .filter((draft) => !input.status || draft.status === input.status)
    .filter(
      (draft) =>
        draft.status !== "active" ||
        draft.sourceCount > 0 ||
        Object.keys(draft.fields).length > 0,
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function getProspectDraft(input: {
  organizationId: string;
  draftId: string;
}): Promise<ProspectDraft | null> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const snap = await db.collection(COLLECTIONS.prospectDrafts).doc(input.draftId).get();
  if (!snap.exists || snap.data()?.organizationId !== input.organizationId) return null;
  return serializeDraft(snap.id, snap.data() as Record<string, unknown>);
}

export async function updateProspectDraftFields(input: {
  organizationId: string;
  userId: string;
  draftId: string;
  values: Partial<Record<ProspectDraftFieldKey, string>>;
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
    const draft = serializeDraft(snap.id, snap.data() as Record<string, unknown>);
    const fields = { ...draft.fields };
    for (const [key, rawValue] of Object.entries(input.values)) {
      const fieldKey = key as ProspectDraftFieldKey;
      if (!PROSPECT_DRAFT_FIELD_KEYS.includes(fieldKey)) continue;
      const value = normalizeProspectDraftFieldValue(fieldKey, rawValue ?? "");
      if (!value) {
        delete fields[fieldKey];
        continue;
      }
      fields[fieldKey] = {
        value,
        confidence: 1,
        status: "verified",
        evidence: fields[fieldKey]?.evidence ?? [],
        updatedAt: new Date().toISOString(),
      };
    }
    const completion = draftCompletion(fields);
    tx.set(ref, stampForUpdate({ fields, ...completion }, input.userId), { merge: true });
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
}): Promise<boolean> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured.");
  const draft = await getProspectDraft(input);
  if (!draft || draft.userId !== input.userId || draft.status !== "active") return false;
  const ref = db.collection(COLLECTIONS.prospectDrafts).doc(input.draftId);
  const lockRef = db.collection(COLLECTIONS.prospectDraftLocks).doc(
    lockId(input.organizationId, input.userId),
  );
  await db.runTransaction(async (tx) => {
    tx.set(
      ref,
      stampForUpdate(
        {
          status: "discarded",
          discardedAt: FieldValue.serverTimestamp(),
          discardReason: input.reason,
        },
        input.userId,
      ),
      { merge: true },
    );
    tx.delete(lockRef);
  });
  return true;
}

export async function completeProspectDraft(input: {
  organizationId: string;
  userId: string;
  draftId: string;
}): Promise<{ leadId: string } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured." };
  const draft = await getProspectDraft(input);
  if (!draft || draft.userId !== input.userId || draft.status !== "active") {
    return { error: "Active draft not found." };
  }
  if (draft.missingRequiredFields.length) {
    return { error: `Complete required fields: ${draft.missingRequiredFields.join(", ")}.` };
  }
  const value = (key: ProspectDraftFieldKey) => draft.fields[key]?.value.trim() || undefined;
  const now = new Date().toISOString();
  const accountId = newId("a");
  const contactId = newId("ct");
  const leadId = newId("l");
  const companyName = value("companyName")!;
  const contactName = value("contactName")!;
  const names = contactName.split(/\s+/);
  const firstName = value("firstName") ?? names[0] ?? contactName;
  const lastName = value("lastName") ?? names.slice(1).join(" ") ?? "";
  const account = withoutUndefined(stampForCreate(
    input.organizationId,
    {
      id: accountId,
      name: companyName,
      domain: value("companyDomain"),
      website: value("companyWebsite"),
      linkedin: value("companyLinkedIn"),
      industry: value("industry"),
      businessDescription: value("businessDescription"),
      city: value("city"),
      state: value("state"),
      country: value("country"),
      yearFounded: value("yearFounded") ? Number(value("yearFounded")) : undefined,
      size: value("companySize"),
      revenueRange: value("revenueRange"),
      techStack: value("techStack")
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      contactCount: 1,
      leadCount: 1,
      openDealValue: 0,
      ownerId: input.userId,
    },
    input.userId,
  ));
  const contact = withoutUndefined(stampForCreate(
    input.organizationId,
    {
      id: contactId,
      accountId,
      firstName,
      lastName,
      fullName: contactName,
      email: value("contactEmail"),
      phone: value("contactPhone"),
      title: value("contactTitle"),
      linkedin: value("contactLinkedIn"),
      ownerId: input.userId,
    },
    input.userId,
  ));
  const notes = [
    value("notes"),
    value("businessFocus") ? `Business focus: ${value("businessFocus")}` : undefined,
    value("hiringSignals") ? `Hiring signals: ${value("hiringSignals")}` : undefined,
    value("recentNews") ? `Recent news: ${value("recentNews")}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
  const lead = withoutUndefined(stampForCreate(
    input.organizationId,
    {
      id: leadId,
      accountId,
      contactId,
      channel: "cold_email",
      stage: "new",
      temperature: "cold",
      priority: "medium",
      ownerId: input.userId,
      createdById: input.userId,
      scraperId: input.userId,
      intakeKind: "prospect",
      prospectOwnerId: input.userId,
      prospectVisibility: "open",
      prospectQualifyStatus: "incomplete",
      contactName,
      contactTitle: value("contactTitle"),
      contactEmail: value("contactEmail"),
      contactLinkedIn: value("contactLinkedIn"),
      companyName,
      companyDomain: value("companyDomain"),
      companyIndustry: value("industry"),
      companySize: value("companySize"),
      revenueRange: value("revenueRange"),
      painPoints: value("painPoints"),
      triggerEvent: value("triggerEvent"),
      notes: notes || undefined,
      qualityScore: draft.qualityScore,
      qualityMatchedSignalIds: draft.qualityMatchedSignalIds,
      primaryOpportunityId: draft.primaryOpportunityId,
      primaryOpportunityLabel: draft.primaryOpportunityLabel,
      strategyId: draft.strategy?.strategyId,
      strategyAssignmentId: draft.strategy?.strategyAssignmentId,
      strategyVersion: draft.strategy?.strategyVersion,
      personaId: draft.strategy?.personaId,
      touches: 0,
      isIdle: false,
      extensions: {
        intentRadarDraft: {
          draftId: draft.id,
          sourceCount: draft.sourceCount,
          completedAt: now,
        },
      },
    },
    input.userId,
  ));
  const batch = db.batch();
  batch.create(db.collection(COLLECTIONS.accounts).doc(accountId), account);
  batch.create(db.collection(COLLECTIONS.contacts).doc(contactId), contact);
  batch.create(db.collection(COLLECTIONS.leads).doc(leadId), lead);
  batch.set(
    db.collection(COLLECTIONS.prospectDrafts).doc(draft.id),
    stampForUpdate(
      {
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        leadId,
      },
      input.userId,
    ),
    { merge: true },
  );
  batch.delete(
    db.collection(COLLECTIONS.prospectDraftLocks).doc(
      lockId(input.organizationId, input.userId),
    ),
  );
  await batch.commit();
  return { leadId };
}
