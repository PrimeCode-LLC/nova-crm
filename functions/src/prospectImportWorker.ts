import { createHash } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

if (!getApps().length) initializeApp();
const db = getFirestore();

const MAX_ROWS_PER_CHUNK = 40;
const MAX_JOB_CHUNKS = 250;
const MAX_CHUNK_ATTEMPTS = 3;

const COLLECTIONS = {
  accounts: "accounts",
  contacts: "contacts",
  leads: "leads",
  users: "users",
  importJobs: "importJobs",
  importJobChunks: "importJobChunks",
  importIdentityKeys: "importIdentityKeys",
  activityRecords: "activityRecords",
  auditLog: "auditLog",
} as const;

type Policy = "add_new" | "update_non_empty" | "replace";
type RowResult = "created" | "updated" | "skipped" | "failed";
type Row = {
  rowNumber: number;
  normalized: Record<string, unknown>;
  issues: { severity: "error" | "warning"; message: string }[];
  identity: string;
  existingAccountId?: string;
  existingContactId?: string;
  existingProspectIds: string[];
};
type Chunk = {
  organizationId: string;
  jobId: string;
  index: number;
  status: string;
  rows: Row[];
  attemptCount: number;
};
type Job = {
  organizationId: string;
  uploaderId: string;
  uploaderEmail?: string;
  filename: string;
  status: string;
  policy?: Policy;
  chunkCount: number;
  completedChunks: number;
  counts: Record<string, number>;
};

function processingLimitError(chunk: Chunk, job: Job): string | undefined {
  if (!Array.isArray(chunk.rows) || chunk.rows.length < 1) {
    return "Import chunk contains no rows.";
  }
  if (chunk.rows.length > MAX_ROWS_PER_CHUNK) {
    return `Import chunk exceeds the ${MAX_ROWS_PER_CHUNK}-row processing limit.`;
  }
  if (
    !Number.isInteger(job.chunkCount) ||
    job.chunkCount < 1 ||
    job.chunkCount > MAX_JOB_CHUNKS
  ) {
    return `Import job exceeds the ${MAX_JOB_CHUNKS}-chunk processing limit.`;
  }
  if (
    !Number.isInteger(chunk.index) ||
    chunk.index < 0 ||
    chunk.index >= job.chunkCount
  ) {
    return "Import chunk index is outside the confirmed job bounds.";
  }
  if (
    !Number.isInteger(chunk.attemptCount) ||
    chunk.attemptCount < 0 ||
    chunk.attemptCount >= MAX_CHUNK_ATTEMPTS
  ) {
    return `Import chunk reached the ${MAX_CHUNK_ATTEMPTS}-attempt retry limit.`;
  }
  return undefined;
}

function isRetryableError(error: unknown): boolean {
  const rawCode =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : "";
  if (typeof rawCode === "number" && [1, 4, 8, 10, 13, 14].includes(rawCode)) return true;
  const code = String(rawCode ?? "");
  return [
    "aborted",
    "cancelled",
    "deadline-exceeded",
    "internal",
    "resource-exhausted",
    "unavailable",
  ].some((value) => code.endsWith(value));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}-${hash(value).slice(0, 28)}`;
}

function cleanRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function dateIso(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00.000Z`
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item))
    : undefined;
}

function wasImportDefaulted(
  row: Record<string, unknown>,
  key: "ownerEmail" | "createdByEmail" | "sourcedByEmail" | "prospectOwnerEmail",
): boolean {
  return row[`__defaulted_${key}`] === true;
}

/** Denormalized manager chain for list-safe manager visibility (matches app helper). */
async function resolveOwnerManagerIdsCached(
  firestore: Firestore,
  ownerId: string,
  cache: Map<string, string[]>,
): Promise<string[]> {
  const oid = ownerId.trim();
  if (!oid) return [];
  const hit = cache.get(oid);
  if (hit) return hit;
  const snap = await firestore.collection(COLLECTIONS.users).doc(oid).get();
  let ids: string[] = [];
  if (snap.exists) {
    const data = snap.data() as Record<string, unknown>;
    const fromStored = Array.isArray(data.managerAncestorIds)
      ? data.managerAncestorIds.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        )
      : [];
    if (fromStored.length > 0) {
      ids = [...new Set(fromStored)];
    } else {
      const mid = typeof data.managerId === "string" ? data.managerId.trim() : "";
      ids = mid ? [mid] : [];
    }
  }
  cache.set(oid, ids);
  return ids;
}

/** Stamp ownerManagerIds when this write includes ownerId (skip when owner was omitted). */
function applyOwnerManagerIds(
  data: Record<string, unknown>,
  ownerManagerIds: string[],
): void {
  if (!("ownerId" in data)) return;
  data.ownerManagerIds = asString(data.ownerId) ? ownerManagerIds : [];
}

function accountValues(row: Record<string, unknown>, ownerId: string): Record<string, unknown> {
  const city = asString(row.city);
  const state = asString(row.state);
  const country = asString(row.country);
  const location = [city, state, country].filter(Boolean).join(", ") || undefined;
  return cleanRecord({
    name: asString(row.companyName),
    domain: asString(row.companyDomain),
    industry: asString(row.industry),
    businessDescription: asString(row.businessDescription),
    size: asString(row.companySize),
    revenueRange: asString(row.revenueRange),
    location,
    city,
    state,
    country,
    yearFounded: typeof row.yearFounded === "number" ? row.yearFounded : undefined,
    businessStatus: asString(row.businessStatus),
    website: asString(row.website),
    websiteStatus: asString(row.websiteStatus),
    linkedin: asString(row.companyLinkedIn),
    techStack: asStringArray(row.techStack),
    onlineActivityScore: asString(row.onlineActivityScore),
    lastWebsiteActivityAt: dateIso(row.lastWebsiteActivityAt),
    lastWebsiteActivityNote: asString(row.lastWebsiteActivityNote),
    careersPageUrl: asString(row.careersPageUrl),
    ownerId,
  });
}

function contactValues(
  row: Record<string, unknown>,
  accountId: string,
  ownerId: string,
): Record<string, unknown> {
  const firstName = asString(row.firstName) ?? "";
  const lastName = asString(row.lastName) ?? "";
  const emailVerificationStatus = asString(row.emailVerificationStatus);
  return cleanRecord({
    accountId,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    email: asString(row.companyEmail),
    personalEmail: asString(row.personalEmail),
    emailVerified: emailVerificationStatus === "verified" ? true : undefined,
    emailVerificationStatus,
    emailVerificationSource: emailVerificationStatus ? "manual" : undefined,
    phone: asString(row.phone),
    linkedin: asString(row.contactLinkedIn),
    title: asString(row.jobTitle),
    seniority: asString(row.seniority),
    location: asString(row.contactLocation),
    contactSource: asString(row.contactSource),
    bestContactChannel: asString(row.bestContactChannel),
    ownerId,
  });
}

function personalizationNote(row: Record<string, unknown>): Record<string, string> | undefined {
  const note = {
    trigger: asString(row.personalizationTrigger) ?? "",
    likelyImpact: asString(row.personalizationLikelyImpact) ?? "",
    relevantService: asString(row.personalizationRelevantService) ?? "",
    suggestedAngle: asString(row.personalizationSuggestedAngle) ?? "",
  };
  const hasContent = Object.values(note).some((value) => value.trim());
  return hasContent ? note : undefined;
}

function formatPsLine(note: Record<string, string> | undefined): string | undefined {
  if (!note) return undefined;
  const line = [
    note.trigger,
    note.likelyImpact,
    note.relevantService,
    note.suggestedAngle,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");
  return line || undefined;
}

function leadValues(
  row: Record<string, unknown>,
  accountId: string,
  contactId: string,
  now: string,
  withDefaults = true,
): Record<string, unknown> {
  const firstName = asString(row.firstName) ?? "";
  const lastName = asString(row.lastName) ?? "";
  const ownerId = asString(row.ownerEmail) ?? "";
  const note = personalizationNote(row);
  const emailVerificationStatus = asString(row.emailVerificationStatus);
  const intentEvidence = Array.isArray(row.intentEvidence) ? row.intentEvidence : undefined;
  return cleanRecord({
    accountId,
    contactId,
    channel: asString(row.channel) ?? (withDefaults ? "cold_email" : undefined),
    profileId: asString(row.profile),
    strategyId: asString(row.strategy),
    personaId: asString(row.persona),
    strategyVersion:
      typeof row.strategyVersion === "number" ? row.strategyVersion : undefined,
    stage: asString(row.stage) ?? (withDefaults ? "new" : undefined),
    temperature: asString(row.temperature) ?? (withDefaults ? "cold" : undefined),
    priority: asString(row.priority) ?? (withDefaults ? "medium" : undefined),
    ownerId,
    createdById: asString(row.createdByEmail) ?? ownerId,
    scraperId: asString(row.sourcedByEmail) ?? ownerId,
    intakeKind: "prospect",
    prospectOwnerId: asString(row.prospectOwnerEmail) ?? ownerId,
    prospectVisibility: withDefaults ? "open" : undefined,
    contactName: `${firstName} ${lastName}`.trim(),
    contactTitle: asString(row.jobTitle),
    contactEmail: asString(row.companyEmail) ?? asString(row.personalEmail),
    contactLinkedIn: asString(row.contactLinkedIn),
    companyName: asString(row.companyName) ?? "",
    companyDomain: asString(row.companyDomain),
    companyIndustry: asString(row.industry),
    companySize: asString(row.companySize),
    revenueRange: asString(row.revenueRange),
    triggerEvent: asString(row.triggerEvent),
    painPoints: asString(row.painPoints),
    personalizationNote: note,
    psLine: formatPsLine(note),
    primaryOpportunityLabel: asString(row.primaryOpportunityLabel),
    deeplyPersonalized:
      typeof row.deeplyPersonalized === "boolean" ? row.deeplyPersonalized : undefined,
    prospectQualifyStatus: asString(row.prospectQualifyStatus),
    rejectionReason: asString(row.rejectionReason),
    rejectionNote: asString(row.rejectionNote),
    intentEvidence,
    emailVerified: emailVerificationStatus === "verified" ? true : undefined,
    doNotContact:
      typeof row.doNotContact === "boolean"
        ? row.doNotContact
        : withDefaults
          ? false
          : undefined,
    touches: withDefaults ? 0 : undefined,
    isIdle: withDefaults ? false : undefined,
    notes: asString(row.notes),
    nextAction: asString(row.nextAction),
    updatedAt: now,
  });
}

function identityValues(row: Record<string, unknown>): string[] {
  const values: string[] = [];
  const companyEmail = asString(row.companyEmail)?.toLowerCase();
  const personalEmail = asString(row.personalEmail)?.toLowerCase();
  const linkedin = asString(row.contactLinkedIn)?.toLowerCase().replace(/\/+$/, "");
  const phoneRaw = asString(row.phone);
  const phone = phoneRaw ? `${phoneRaw.startsWith("+") ? "+" : ""}${phoneRaw.replace(/\D/g, "")}` : "";
  if (companyEmail) values.push(`email:${companyEmail}`);
  if (personalEmail) values.push(`email:${personalEmail}`);
  if (linkedin) values.push(`linkedin:${linkedin}`);
  if (phone) values.push(`phone:${phone}`);
  return [...new Set(values)];
}

function replacePatch(
  values: Record<string, unknown>,
  requiredKeys: Set<string>,
  replaceableKeys: readonly string[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    patch[key] = value;
  }
  for (const key of replaceableKeys) {
    if (!requiredKeys.has(key) && !(key in patch)) patch[key] = FieldValue.delete();
  }
  return patch;
}

async function processRow(
  firestore: Firestore,
  jobId: string,
  orgId: string,
  policy: Policy,
  row: Row,
  managerCache: Map<string, string[]>,
): Promise<RowResult> {
  if (row.issues.some((issue) => issue.severity === "error")) return "skipped";
  if (policy === "add_new" && (row.existingContactId || row.existingProspectIds.length)) return "skipped";
  if (policy !== "add_new" && row.existingProspectIds.length > 1) return "failed";

  const ownerIdForManagers = asString(row.normalized.ownerEmail) ?? "";
  const ownerManagerIds = await resolveOwnerManagerIdsCached(
    firestore,
    ownerIdForManagers,
    managerCache,
  );

  const receiptId = hash(`${orgId}:receipt:${jobId}:${row.rowNumber}`);
  const receiptRef = firestore.collection(COLLECTIONS.importIdentityKeys).doc(receiptId);
  const domain = asString(row.normalized.companyDomain)!;
  const accountKeyRef = firestore.collection(COLLECTIONS.importIdentityKeys).doc(hash(`${orgId}:domain:${domain}`));
  const identities = identityValues(row.normalized);
  const contactKeyRefs = identities.map((identity) =>
    firestore.collection(COLLECTIONS.importIdentityKeys).doc(hash(`${orgId}:${identity}`)),
  );

  return firestore.runTransaction(async (transaction) => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      if (asString(receipt.data()?.organizationId) !== orgId) return "failed";
      return String(receipt.data()?.result ?? "failed") as RowResult;
    }

    const [accountKey, ...contactKeys] = await Promise.all([
      transaction.get(accountKeyRef),
      ...contactKeyRefs.map((ref) => transaction.get(ref)),
    ]);
    if (
      [accountKey, ...contactKeys].some(
        (snapshot) =>
          snapshot.exists && asString(snapshot.data()?.organizationId) !== orgId,
      )
    ) {
      transaction.create(receiptRef, {
        organizationId: orgId,
        kind: "receipt",
        jobId,
        rowNumber: row.rowNumber,
        result: "failed",
      });
      return "failed";
    }
    const keyContactIds = new Set(
      contactKeys.map((snapshot) => asString(snapshot.data()?.entityId)).filter((id): id is string => Boolean(id)),
    );
    if (
      keyContactIds.size > 1 ||
      (row.existingContactId && keyContactIds.size === 1 && !keyContactIds.has(row.existingContactId))
    ) {
      transaction.create(receiptRef, { organizationId: orgId, kind: "receipt", jobId, rowNumber: row.rowNumber, result: "failed" });
      return "failed";
    }

    const accountId =
      asString(accountKey.data()?.entityId) ??
      row.existingAccountId ??
      deterministicId("a", `${orgId}:${domain}`);
    if (
      row.existingAccountId &&
      accountKey.exists &&
      asString(accountKey.data()?.entityId) !== row.existingAccountId
    ) {
      transaction.create(receiptRef, { organizationId: orgId, kind: "receipt", jobId, rowNumber: row.rowNumber, result: "failed" });
      return "failed";
    }
    const contactId =
      [...keyContactIds][0] ??
      row.existingContactId ??
      deterministicId("ct", `${orgId}:${row.identity}`);
    const prospectKeyRef = firestore
      .collection(COLLECTIONS.importIdentityKeys)
      .doc(hash(`${orgId}:prospect:${contactId}`));
    const prospectKey = await transaction.get(prospectKeyRef);
    if (
      prospectKey.exists &&
      asString(prospectKey.data()?.organizationId) !== orgId
    ) {
      transaction.create(receiptRef, {
        organizationId: orgId,
        kind: "receipt",
        jobId,
        rowNumber: row.rowNumber,
        result: "failed",
      });
      return "failed";
    }
    const keyedProspectId = asString(prospectKey.data()?.entityId);
    if (
      row.existingProspectIds.length === 1 &&
      keyedProspectId &&
      keyedProspectId !== row.existingProspectIds[0]
    ) {
      transaction.create(receiptRef, { organizationId: orgId, kind: "receipt", jobId, rowNumber: row.rowNumber, result: "failed" });
      return "failed";
    }
    const accountRef = firestore.collection(COLLECTIONS.accounts).doc(accountId);
    const contactRef = firestore.collection(COLLECTIONS.contacts).doc(contactId);
    const existingProspectId =
      policy === "add_new"
        ? undefined
        : keyedProspectId ?? row.existingProspectIds[0];
    const leadId = existingProspectId ?? deterministicId("l", `${jobId}:${row.rowNumber}`);
    const leadRef = firestore.collection(COLLECTIONS.leads).doc(leadId);

    const [accountSnap, contactSnap, leadSnap] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(contactRef),
      transaction.get(leadRef),
    ]);
    if (
      [accountSnap, contactSnap, leadSnap].some(
        (snapshot) =>
          snapshot.exists && asString(snapshot.data()?.organizationId) !== orgId,
      )
    ) {
      transaction.create(receiptRef, {
        organizationId: orgId,
        kind: "receipt",
        jobId,
        rowNumber: row.rowNumber,
        result: "failed",
      });
      return "failed";
    }
    if (
      accountSnap.exists &&
      asString(accountSnap.data()?.domain)?.toLowerCase() !== domain
    ) {
      transaction.create(receiptRef, {
        organizationId: orgId,
        kind: "receipt",
        jobId,
        rowNumber: row.rowNumber,
        result: "failed",
      });
      return "failed";
    }
    if (contactSnap.exists) {
      const storedIdentities = new Set(identityValues({
        companyEmail: contactSnap.data()?.email,
        personalEmail: contactSnap.data()?.personalEmail,
        contactLinkedIn: contactSnap.data()?.linkedin,
        phone: contactSnap.data()?.phone,
      }));
      if (!identities.some((identity) => storedIdentities.has(identity))) {
        transaction.create(receiptRef, {
          organizationId: orgId,
          kind: "receipt",
          jobId,
          rowNumber: row.rowNumber,
          result: "failed",
        });
        return "failed";
      }
    }
    if (policy === "add_new" && contactSnap.exists) {
      transaction.create(receiptRef, { organizationId: orgId, kind: "receipt", jobId, rowNumber: row.rowNumber, result: "skipped" });
      return "skipped";
    }

    const now = new Date().toISOString();
    const ownerId = asString(row.normalized.ownerEmail) ?? "";
    const accountData = accountValues(row.normalized, ownerId);
    const contactData = contactValues(row.normalized, accountId, ownerId);
    const leadData = leadValues(
      row.normalized,
      accountId,
      contactId,
      now,
      !leadSnap.exists,
    );
    const isUpdate = leadSnap.exists || Boolean(existingProspectId);
    if (accountSnap.exists && wasImportDefaulted(row.normalized, "ownerEmail")) {
      delete accountData.ownerId;
    }
    if (contactSnap.exists && wasImportDefaulted(row.normalized, "ownerEmail")) {
      delete contactData.ownerId;
    }
    if (contactSnap.exists) {
      delete contactData.accountId;
    }
    if (leadSnap.exists) {
      delete leadData.accountId;
      delete leadData.contactId;
      if (wasImportDefaulted(row.normalized, "ownerEmail")) delete leadData.ownerId;
      if (wasImportDefaulted(row.normalized, "createdByEmail")) delete leadData.createdById;
      if (wasImportDefaulted(row.normalized, "sourcedByEmail")) delete leadData.scraperId;
      if (wasImportDefaulted(row.normalized, "prospectOwnerEmail")) {
        delete leadData.prospectOwnerId;
      }
    }
    applyOwnerManagerIds(accountData, ownerManagerIds);
    applyOwnerManagerIds(contactData, ownerManagerIds);
    applyOwnerManagerIds(leadData, ownerManagerIds);

    if (!accountSnap.exists) {
      transaction.create(accountRef, {
        id: accountId,
        organizationId: orgId,
        ...accountData,
        contactCount: 1,
        leadCount: 1,
        openDealValue: 0,
        createdAt: now,
        updatedAt: now,
      });
    } else if (policy !== "add_new") {
      // Account data is shared by multiple contacts/prospects. Never clear shared
      // fields from one row's blanks, even under the lead-level replace policy.
      transaction.set(accountRef, { ...accountData, updatedAt: now }, { merge: true });
      if (!contactSnap.exists) transaction.update(accountRef, { contactCount: FieldValue.increment(1) });
      if (!leadSnap.exists) transaction.update(accountRef, { leadCount: FieldValue.increment(1) });
    } else {
      transaction.update(accountRef, {
        contactCount: FieldValue.increment(1),
        leadCount: FieldValue.increment(1),
        updatedAt: now,
      });
    }

    if (!contactSnap.exists) {
      transaction.create(contactRef, {
        id: contactId,
        organizationId: orgId,
        ...contactData,
        createdAt: now,
        updatedAt: now,
      });
    } else if (policy !== "add_new") {
      // Contacts can be referenced by more than one CRM record. Preserve omitted
      // shared fields and only merge explicitly supplied non-empty values.
      transaction.set(contactRef, { ...contactData, updatedAt: now }, { merge: true });
    }

    if (!leadSnap.exists) {
      transaction.create(leadRef, {
        id: leadId,
        organizationId: orgId,
        ...leadData,
        createdAt: now,
      });
    } else if (policy !== "add_new") {
      const patch = policy === "replace"
        ? replacePatch(leadData, new Set([
            "accountId", "contactId", "channel", "stage", "temperature", "priority", "ownerId",
            "intakeKind", "prospectOwnerId", "prospectVisibility", "contactName", "companyName",
            "touches", "isIdle", "doNotContact", "updatedAt",
          ]), [
            "accountId", "contactId", "channel", "campaignId", "profileId", "stage",
            "temperature", "priority", "ownerId", "createdById", "scraperId", "intakeKind",
            "prospectOwnerId", "prospectVisibility", "contactName", "contactTitle", "contactEmail",
            "contactLinkedIn", "companyName", "companyDomain", "companyIndustry", "companySize",
            "revenueRange", "triggerEvent", "painPoints", "businessFocus", "hiringSignals",
            "recentNews", "psLine", "toolsUsed", "caseStudyId", "pushToInstantly",
            "pushToLinkedIn", "doNotContact", "bant", "estimatedValue", "expectedCloseDate",
            "firstContactAt", "lastActivityAt", "responseTimeMinutes", "touches", "isIdle",
            "idleDays", "notes", "nextAction", "extensions", "labelIds", "updatedAt",
          ])
        : leadData;
      transaction.set(leadRef, patch, { merge: true });
    }

    if (!accountKey.exists) {
      transaction.create(accountKeyRef, { organizationId: orgId, kind: "domain", normalizedValue: domain, entityId: accountId, createdAt: now });
    }
    contactKeys.forEach((keySnapshot, index) => {
      if (!keySnapshot.exists) {
        transaction.create(contactKeyRefs[index]!, {
          organizationId: orgId,
          kind: "contact",
          normalizedValue: identities[index],
          entityId: contactId,
          createdAt: now,
        });
      }
    });
    if (!prospectKey.exists) {
      transaction.create(prospectKeyRef, {
        organizationId: orgId,
        kind: "prospect",
        normalizedValue: contactId,
        entityId: leadId,
        createdAt: now,
      });
    }
    const result: RowResult = isUpdate ? "updated" : "created";
    transaction.create(receiptRef, {
      organizationId: orgId,
      kind: "receipt",
      jobId,
      rowNumber: row.rowNumber,
      result,
      accountId,
      contactId,
      leadId,
      createdAt: now,
    });
    return result;
  });
}

async function finalizeChunk(
  chunkRef: DocumentReference,
  jobRef: DocumentReference,
  chunk: Chunk,
  results: Record<RowResult, number>,
): Promise<void> {
  await db.runTransaction(async (transaction: Transaction) => {
    const [chunkSnap, jobSnap] = await Promise.all([
      transaction.get(chunkRef),
      transaction.get(jobRef),
    ]);
    if (!chunkSnap.exists || chunkSnap.data()?.status === "completed") return;
    const job = jobSnap.data() as Job | undefined;
    if (!job) return;
    const completedChunks = Number(job.completedChunks ?? 0) + 1;
    const terminal = completedChunks >= Number(job.chunkCount ?? 0);
    const cancelled = job.status === "cancel_requested";
    const failedTotal = Number(job.counts?.failed ?? 0) + results.failed;
    const now = new Date().toISOString();
    transaction.update(chunkRef, {
      status: cancelled ? "cancelled" : "completed",
      completedAt: now,
      updatedAt: now,
    });
    const jobPatch: Record<string, unknown> = {
      status: terminal
        ? cancelled
          ? "cancelled"
          : failedTotal > 0
            ? "completed_with_errors"
            : "completed"
        : cancelled
          ? "cancel_requested"
          : "processing",
      completedChunks,
      updatedAt: now,
      "counts.created": FieldValue.increment(results.created),
      "counts.updated": FieldValue.increment(results.updated),
      "counts.skipped": FieldValue.increment(results.skipped),
      "counts.failed": FieldValue.increment(results.failed),
      "counts.processed": FieldValue.increment(
        results.created + results.updated + results.skipped + results.failed,
      ),
    };
    if (terminal) {
      jobPatch.completedAt = now;
      jobPatch.cleanupAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }
    transaction.update(jobRef, jobPatch);
    if (terminal) {
      const activityId = deterministicId("ar", `${chunk.jobId}:completed`);
      transaction.set(db.collection(COLLECTIONS.activityRecords).doc(activityId), {
        id: activityId,
        organizationId: chunk.organizationId,
        userId: job.uploaderId,
        channel: "website_form",
        type: "import_completed",
        occurredAt: now,
        summary: cancelled
          ? `Prospect import cancelled after processing ${Number(job.counts?.processed ?? 0) + results.created + results.updated + results.skipped + results.failed} rows`
          : `Prospect import completed: ${Number(job.counts?.created ?? 0) + results.created} created, ${Number(job.counts?.updated ?? 0) + results.updated} updated`,
        metadata: { jobId: chunk.jobId, filename: job.filename },
      });
      const auditId = deterministicId("audit", `${chunk.jobId}:completed`);
      transaction.set(db.collection(COLLECTIONS.auditLog).doc(auditId), {
        id: auditId,
        organizationId: chunk.organizationId,
        actorUid: job.uploaderId,
        actorEmail: job.uploaderEmail ?? null,
        event: "feature.import",
        operation: "action",
        tableName: "leads",
        message: `Prospect import ${cancelled ? "cancelled" : "completed"}`,
        meta: {
          jobId: chunk.jobId,
          filename: job.filename,
          created: Number(job.counts?.created ?? 0) + results.created,
          updated: Number(job.counts?.updated ?? 0) + results.updated,
          skipped: Number(job.counts?.skipped ?? 0) + results.skipped,
          failed: failedTotal,
        },
        createdAt: now,
      });
    }
  });
}

async function failClaimedChunk(
  chunkRef: DocumentReference,
  jobRef: DocumentReference,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.runTransaction(async (transaction) => {
    const [chunkSnap, jobSnap] = await Promise.all([
      transaction.get(chunkRef),
      transaction.get(jobRef),
    ]);
    if (!chunkSnap.exists || chunkSnap.data()?.status !== "processing") return;
    const now = new Date().toISOString();
    transaction.update(chunkRef, {
      status: "failed",
      completedAt: now,
      error: message,
      updatedAt: now,
    });
    if (
      jobSnap.exists &&
      ["queued", "processing"].includes(String(jobSnap.data()?.status ?? ""))
    ) {
      transaction.update(jobRef, {
        status: "failed",
        completedAt: now,
        cleanupAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        error: message,
        updatedAt: now,
      });
    }
  });
}

export const processProspectImportChunk = onDocumentUpdated(
  {
    document: "importJobChunks/{chunkId}",
    timeoutSeconds: 180,
    memory: "1GiB",
    minInstances: 0,
    maxInstances: 3,
    concurrency: 1,
    retry: false,
  },
  async (event) => {
    // P4.3: BullMQ worker owns apply when queue flags are on (confirm enqueues jobs).
    if (
      process.env.QUEUE_WORKER_V1 === "true" &&
      process.env.QUEUE_IMPORT_CHUNKS_V1 === "true"
    ) {
      return;
    }
    const before = event.data?.before.data() as Chunk | undefined;
    const after = event.data?.after.data() as Chunk | undefined;
    if (!after || before?.status === "queued" || after.status !== "queued") return;
    const chunkRef = event.data!.after.ref;
    const jobRef = db.collection(COLLECTIONS.importJobs).doc(after.jobId);
    const claimed = await db.runTransaction(async (transaction) => {
      const [chunkSnap, jobSnap] = await Promise.all([
        transaction.get(chunkRef),
        transaction.get(jobRef),
      ]);
      if (chunkSnap.data()?.status !== "queued") return false;
      const job = jobSnap.data() as Job | undefined;
      if (!job || !job.policy) return false;
      if (!["queued", "processing", "cancel_requested"].includes(job.status)) {
        return false;
      }
      const currentChunk = chunkSnap.data() as Chunk;
      const limitError =
        currentChunk.jobId !== after.jobId ||
        currentChunk.organizationId !== job.organizationId
          ? "Import chunk tenant or job metadata does not match its parent job."
          : processingLimitError(currentChunk, job);
      if (limitError) {
        const now = new Date().toISOString();
        transaction.update(chunkRef, {
          status: "failed",
          completedAt: now,
          error: limitError,
          updatedAt: now,
        });
        transaction.update(jobRef, {
          status: "failed",
          completedAt: now,
          cleanupAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          error: limitError,
          updatedAt: now,
          "counts.failed": FieldValue.increment(currentChunk.rows.length),
          "counts.processed": FieldValue.increment(currentChunk.rows.length),
        });
        return false;
      }
      if (job.status === "cancel_requested") {
        transaction.update(chunkRef, { status: "processing", updatedAt: new Date().toISOString() });
        return true;
      }
      transaction.update(chunkRef, {
        status: "processing",
        attemptCount: FieldValue.increment(1),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (job.status === "queued") {
        transaction.update(jobRef, { status: "processing", updatedAt: new Date().toISOString() });
      }
      return true;
    });
    if (!claimed) return;

    try {
      const jobSnapshot = await jobRef.get();
      const job = jobSnapshot.data() as Job | undefined;
      if (!job?.policy) throw new Error("Import job has no confirmed policy.");
      const results: Record<RowResult, number> = { created: 0, updated: 0, skipped: 0, failed: 0 };
      const managerCache = new Map<string, string[]>();
      if (job.status !== "cancel_requested") {
        for (const row of after.rows) {
          const latestJob = await jobRef.get();
          if (latestJob.data()?.status === "cancel_requested") break;
          try {
            const result = await processRow(
              db,
              after.jobId,
              after.organizationId,
              job.policy,
              row,
              managerCache,
            );
            results[result]++;
          } catch (error) {
            console.error("Prospect import row failed", {
              jobId: after.jobId,
              rowNumber: row.rowNumber,
              error,
            });
            if (isRetryableError(error)) {
              const currentChunk = await chunkRef.get();
              const attempts = Number(currentChunk.data()?.attemptCount ?? 0);
              if (attempts < MAX_CHUNK_ATTEMPTS) {
                await chunkRef.update({
                  status: "queued",
                  error: error instanceof Error ? error.message : String(error),
                  updatedAt: new Date().toISOString(),
                });
                return;
              }
            }
            results.failed++;
          }
        }
      }
      await finalizeChunk(chunkRef, jobRef, after, results);
    } catch (error) {
      console.error("Prospect import chunk failed", {
        jobId: after.jobId,
        chunkId: event.params.chunkId,
        error,
      });
      await failClaimedChunk(chunkRef, jobRef, error);
    }
  },
);

async function deleteInBatches(refs: DocumentReference[]): Promise<void> {
  for (let index = 0; index < refs.length; index += 400) {
    const batch = db.batch();
    refs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export const cleanupProspectImportTemporaryData = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "512MiB",
    minInstances: 0,
    maxInstances: 1,
  },
  async () => {
    const now = new Date().toISOString();
    const jobs = await db.collection(COLLECTIONS.importJobs)
      .where("cleanupAfter", "<=", now)
      .limit(2)
      .get();
    for (const job of jobs.docs) {
      const organizationId = asString(job.data().organizationId);
      if (!organizationId) continue;
      const [chunksSnapshot, receiptsSnapshot] = await Promise.all([
        db.collection(COLLECTIONS.importJobChunks).where("jobId", "==", job.id).get(),
        db.collection(COLLECTIONS.importIdentityKeys).where("jobId", "==", job.id).get(),
      ]);
      await deleteInBatches([
        ...chunksSnapshot.docs
          .filter((doc) => asString(doc.data().organizationId) === organizationId)
          .map((doc) => doc.ref),
        ...receiptsSnapshot.docs
          .filter((doc) => asString(doc.data().organizationId) === organizationId)
          .map((doc) => doc.ref),
      ]);
      await job.ref.update({
        issueSamples: FieldValue.delete(),
        cleanupAfter: FieldValue.delete(),
        temporaryDataDeletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  },
);

export const __test = {
  accountValues,
  contactValues,
  deterministicId,
  identityValues,
  isRetryableError,
  leadValues,
  processingLimitError,
};
