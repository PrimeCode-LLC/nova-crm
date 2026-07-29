import { createHash, randomUUID } from "node:crypto";
import {
  FieldValue,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ParsedProspectImport } from "@/lib/imports/prospect-import-parse";
import type { NormalizedProspectImportRow } from "@/lib/imports/prospect-import-schema";
import {
  EMPTY_IMPORT_COUNTS,
  type ProspectImportChunk,
  type ProspectImportJob,
  type ProspectImportPolicy,
  type StagedProspectImportRow,
} from "@/lib/imports/prospect-import-types";

const QUERY_CHUNK_SIZE = 30;
const ROWS_PER_CHUNK = 40;
const MAX_CHUNK_JSON_BYTES = 700_000;
const STAGING_CHUNKS_PER_COMMIT = 10;
const ISSUE_SAMPLE_LIMIT = 100;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value)))];
}

function identityDocId(organizationId: string, value: string): string {
  return createHash("sha256").update(`${organizationId}:${value}`).digest("hex");
}

async function getIdentityDocuments(
  db: Firestore,
  organizationId: string,
  values: string[],
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const documents: QueryDocumentSnapshot<DocumentData>[] = [];
  for (const valueChunk of chunks(uniqueStrings(values), 400)) {
    const refs = valueChunk.map((value) =>
      db.collection(COLLECTIONS.importIdentityKeys).doc(identityDocId(organizationId, value)),
    );
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      if (snapshot.exists) documents.push(snapshot as QueryDocumentSnapshot<DocumentData>);
    }
  }
  return documents;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedDeep(item)]),
    ) as T;
  }
  return value;
}

async function queryTenantValues(
  db: Firestore,
  organizationId: string,
  collectionName: string,
  field: string,
  values: string[],
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const organizationIds = new Set<string>();
  const out: QueryDocumentSnapshot<DocumentData>[] = [];
  if (!values.length) return out;
  for (const valueChunk of chunks(uniqueStrings(values), QUERY_CHUNK_SIZE)) {
    const snapshot = await db
      .collection(collectionName)
      .where("organizationId", "==", organizationId)
      .where(field, "in", valueChunk)
      .get();
    for (const doc of snapshot.docs) {
      const organizationId = String(doc.data().organizationId ?? "");
      if (!organizationIds.has(`${doc.ref.path}:${organizationId}`)) {
        organizationIds.add(`${doc.ref.path}:${organizationId}`);
        out.push(doc);
      }
    }
  }
  return out;
}

function normalizedPhone(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const plus = raw.startsWith("+") ? "+" : "";
  return `${plus}${raw.replace(/\D/g, "")}`;
}

function normalizedLinkedIn(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\/+$/, "") : "";
}

function contactIdentities(row: NormalizedProspectImportRow): string[] {
  return uniqueStrings([
    typeof row.companyEmail === "string" ? `email:${row.companyEmail}` : "",
    typeof row.personalEmail === "string" ? `email:${row.personalEmail}` : "",
    typeof row.contactLinkedIn === "string"
      ? `linkedin:${normalizedLinkedIn(row.contactLinkedIn)}`
      : "",
    row.phone ? `phone:${normalizedPhone(row.phone)}` : "",
  ]);
}

function contactIdentity(row: NormalizedProspectImportRow): string {
  return contactIdentities(row)[0] ?? "";
}

function addIssue(
  rowNumber: number,
  issues: StagedProspectImportRow["issues"],
  severity: "error" | "warning",
  code: string,
  message: string,
  field?: string,
): void {
  issues.push({
    rowNumber,
    ...(field ? { field } : {}),
    severity,
    code,
    message,
  });
}

function lookupByNameOrId(
  docs: QueryDocumentSnapshot<DocumentData>[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const doc of docs) {
    map.set(doc.id.toLowerCase(), doc.id);
    const name = String(doc.data().name ?? "").trim().toLowerCase();
    if (name) map.set(name, doc.id);
  }
  return map;
}

function resolveSingleReference(
  rowNumber: number,
  normalized: NormalizedProspectImportRow,
  key: "profile" | "strategy" | "persona",
  label: string,
  lookup: Map<string, string>,
  issues: StagedProspectImportRow["issues"],
): void {
  const raw = typeof normalized[key] === "string" ? normalized[key].trim() : "";
  if (!raw) return;
  const id = lookup.get(raw.toLowerCase());
  if (id) normalized[key] = id;
  else {
    delete normalized[key];
    addIssue(rowNumber, issues, "warning", "unknown_reference", `${label} "${raw}" was ignored.`, label);
  }
}

function splitStagedRows(rows: StagedProspectImportRow[]): StagedProspectImportRow[][] {
  const result: StagedProspectImportRow[][] = [];
  let current: StagedProspectImportRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
    if (current.length && (current.length >= ROWS_PER_CHUNK || bytes + rowBytes > MAX_CHUNK_JSON_BYTES)) {
      result.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += rowBytes;
  }
  if (current.length) result.push(current);
  return result;
}

export async function createProspectImportPreview(input: {
  db: Firestore;
  organizationId: string;
  uploaderId: string;
  uploaderEmail?: string;
  parsed: ParsedProspectImport;
}): Promise<ProspectImportJob> {
  const { db, organizationId, uploaderId, uploaderEmail, parsed } = input;
  const validParsedRows = parsed.rows.filter((row) => !row.issues.some((issue) => issue.severity === "error"));
  const domains = uniqueStrings(validParsedRows.map((row) => row.normalized.companyDomain));
  const companyEmails = uniqueStrings(validParsedRows.map((row) => row.normalized.companyEmail));
  const personalEmails = uniqueStrings(validParsedRows.map((row) => row.normalized.personalEmail));
  const linkedInUrls = uniqueStrings(validParsedRows.map((row) => row.normalized.contactLinkedIn));
  const phones = uniqueStrings(validParsedRows.map((row) => row.normalized.phone));
  const normalizedContactIdentities = uniqueStrings(
    validParsedRows.flatMap((row) => [
      typeof row.normalized.companyEmail === "string" ? `email:${row.normalized.companyEmail}` : "",
      typeof row.normalized.personalEmail === "string" ? `email:${row.normalized.personalEmail}` : "",
      typeof row.normalized.contactLinkedIn === "string"
        ? `linkedin:${normalizedLinkedIn(row.normalized.contactLinkedIn)}`
        : "",
      row.normalized.phone ? `phone:${normalizedPhone(row.normalized.phone)}` : "",
    ]),
  );

  const [
    accountDocs,
    companyEmailDocs,
    personalEmailDocs,
    linkedInDocs,
    phoneDocs,
    profilesSnap,
    strategiesSnap,
    personasSnap,
    previousJobSnap,
    identityDocs,
  ] = await Promise.all([
    queryTenantValues(db, organizationId, COLLECTIONS.accounts, "domain", domains),
    queryTenantValues(db, organizationId, COLLECTIONS.contacts, "email", companyEmails),
    queryTenantValues(db, organizationId, COLLECTIONS.contacts, "personalEmail", personalEmails),
    queryTenantValues(db, organizationId, COLLECTIONS.contacts, "linkedin", linkedInUrls),
    queryTenantValues(db, organizationId, COLLECTIONS.contacts, "phone", phones),
    db.collection(COLLECTIONS.profiles).where("organizationId", "==", organizationId).get(),
    db.collection(COLLECTIONS.prospectingStrategies).where("organizationId", "==", organizationId).get(),
    db.collection(COLLECTIONS.buyerPersonas).where("organizationId", "==", organizationId).get(),
    db.collection(COLLECTIONS.importJobs)
      .where("organizationId", "==", organizationId)
      .where("fingerprint", "==", parsed.fingerprint)
      .limit(1)
      .get(),
    getIdentityDocuments(
      db,
      organizationId,
      [...domains.map((domain) => `domain:${domain}`), ...normalizedContactIdentities],
    ),
  ]);

  const sameOrg = (doc: QueryDocumentSnapshot<DocumentData>) =>
    String(doc.data().organizationId ?? "") === organizationId;
  const accountByDomain = new Map(
    accountDocs.filter(sameOrg).map((doc) => [String(doc.data().domain ?? "").toLowerCase(), doc.id]),
  );
  const contactsByIdentity = new Map<string, Set<string>>();
  const addContactIdentity = (kind: string, value: string, id: string) => {
    const key = `${kind}:${value}`;
    const ids = contactsByIdentity.get(key) ?? new Set<string>();
    ids.add(id);
    contactsByIdentity.set(key, ids);
  };
  for (const doc of companyEmailDocs.filter(sameOrg)) addContactIdentity("email", String(doc.data().email ?? "").toLowerCase(), doc.id);
  for (const doc of personalEmailDocs.filter(sameOrg)) addContactIdentity("email", String(doc.data().personalEmail ?? "").toLowerCase(), doc.id);
  for (const doc of linkedInDocs.filter(sameOrg)) addContactIdentity("linkedin", normalizedLinkedIn(doc.data().linkedin), doc.id);
  for (const doc of phoneDocs.filter(sameOrg)) addContactIdentity("phone", normalizedPhone(doc.data().phone), doc.id);
  for (const doc of identityDocs) {
    const data = doc.data();
    const kind = String(data.kind ?? "");
    const normalizedValue = String(data.normalizedValue ?? "");
    const entityId = String(data.entityId ?? "");
    if (!entityId || String(data.organizationId ?? "") !== organizationId) continue;
    if (kind === "domain") accountByDomain.set(normalizedValue, entityId);
    if (kind === "contact") {
      const separator = normalizedValue.indexOf(":");
      if (separator > 0) {
        addContactIdentity(
          normalizedValue.slice(0, separator),
          normalizedValue.slice(separator + 1),
          entityId,
        );
      }
    }
  }

  const contactIds = [...new Set([...contactsByIdentity.values()].flatMap((ids) => [...ids]))];
  const contactAccountById = new Map<string, string>();
  const loadedContactDocs = [
    ...companyEmailDocs,
    ...personalEmailDocs,
    ...linkedInDocs,
    ...phoneDocs,
  ].filter(sameOrg);
  for (const doc of loadedContactDocs) {
    contactAccountById.set(doc.id, String(doc.data().accountId ?? ""));
  }
  const missingContactIds = contactIds.filter((contactId) => !contactAccountById.has(contactId));
  for (const idChunk of chunks(missingContactIds, 400)) {
    const snapshots = await db.getAll(
      ...idChunk.map((contactId) => db.collection(COLLECTIONS.contacts).doc(contactId)),
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists && snapshot.data()?.organizationId === organizationId) {
        contactAccountById.set(snapshot.id, String(snapshot.data()?.accountId ?? ""));
      }
    }
  }
  const prospectsByContact = new Map<string, string[]>();
  for (const contactIdChunk of chunks(contactIds, QUERY_CHUNK_SIZE)) {
    const snapshot = await db.collection(COLLECTIONS.leads)
      .where("organizationId", "==", organizationId)
      .where("intakeKind", "==", "prospect")
      .where("contactId", "in", contactIdChunk)
      .get();
    for (const doc of snapshot.docs) {
      const contactId = String(doc.data().contactId ?? "");
      prospectsByContact.set(contactId, [...(prospectsByContact.get(contactId) ?? []), doc.id]);
    }
  }

  const profileLookup = lookupByNameOrId(profilesSnap.docs);
  const strategyLookup = lookupByNameOrId(strategiesSnap.docs);
  const personaLookup = lookupByNameOrId(personasSnap.docs);
  const strategyVersionById = new Map<string, number>();
  for (const doc of strategiesSnap.docs) {
    const version = Number(doc.data().version);
    if (Number.isInteger(version) && version > 0) strategyVersionById.set(doc.id, version);
  }
  const seenInFile = new Set<string>();
  const stagedRows: StagedProspectImportRow[] = [];
  const counts = { ...EMPTY_IMPORT_COUNTS, total: parsed.rows.length };

  for (const parsedRow of parsed.rows) {
    const normalized = structuredClone(parsedRow.normalized) as NormalizedProspectImportRow &
      Record<string, unknown>;
    const issues = [...parsedRow.issues];
    const identity = contactIdentity(normalized);
    const rowIdentities = contactIdentities(normalized);
    const duplicateInFile = rowIdentities.some((candidate) => seenInFile.has(candidate));
    if (duplicateInFile) {
      counts.inFileDuplicates++;
      addIssue(parsedRow.rowNumber, issues, "error", "in_file_duplicate", "A previous row in this file has the same contact identity.");
    }
    rowIdentities.forEach((candidate) => seenInFile.add(candidate));

    // Owners always default to the uploader (New prospect form behavior).
    for (const key of [
      "ownerEmail",
      "createdByEmail",
      "sourcedByEmail",
      "prospectOwnerEmail",
    ] as const) {
      normalized[key] = uploaderId;
      normalized[`__defaulted_${key}`] = true;
    }

    resolveSingleReference(parsedRow.rowNumber, normalized, "profile", "Outreach Profile", profileLookup, issues);
    resolveSingleReference(parsedRow.rowNumber, normalized, "strategy", "Prospecting Strategy", strategyLookup, issues);
    resolveSingleReference(parsedRow.rowNumber, normalized, "persona", "Buyer Persona", personaLookup, issues);
    if (typeof normalized.strategy === "string") {
      const version = strategyVersionById.get(normalized.strategy);
      if (version) normalized.strategyVersion = version;
    }

    const matchingContactIds = new Set<string>();
    const identityCandidates = contactIdentities(normalized);
    for (const candidate of identityCandidates) {
      for (const contactId of contactsByIdentity.get(candidate) ?? []) matchingContactIds.add(contactId);
    }
    if (matchingContactIds.size > 1) {
      addIssue(parsedRow.rowNumber, issues, "error", "ambiguous_contact", "The supplied identities match more than one existing contact.");
    }
    const existingContactId = matchingContactIds.size === 1 ? [...matchingContactIds][0] : undefined;
    const existingProspectIds = existingContactId ? prospectsByContact.get(existingContactId) ?? [] : [];
    const existingAccountId = accountByDomain.get(
      String(normalized.companyDomain ?? "").toLowerCase(),
    );
    if (
      existingContactId &&
      contactAccountById.get(existingContactId) &&
      contactAccountById.get(existingContactId) !== existingAccountId
    ) {
      addIssue(
        parsedRow.rowNumber,
        issues,
        "error",
        "contact_company_conflict",
        "The existing contact belongs to a different company domain.",
        "Company Domain",
      );
    }
    if (existingContactId) counts.existingContacts++;
    if (existingProspectIds.length) counts.existingProspects++;
    if (existingProspectIds.length > 1) counts.ambiguousProspects++;
    counts.warnings += issues.filter((issue) => issue.severity === "warning").length;
    const hasError = issues.some((issue) => issue.severity === "error");
    if (hasError) counts.invalid++;
    else counts.valid++;

    stagedRows.push({
      rowNumber: parsedRow.rowNumber,
      normalized,
      issues,
      identity,
      existingAccountId,
      existingContactId,
      existingProspectIds,
    });
  }

  const now = new Date().toISOString();
  const jobId = `imp-${randomUUID()}`;
  const rowChunks = splitStagedRows(stagedRows);
  const job: ProspectImportJob = {
    id: jobId,
    organizationId,
    uploaderId,
    uploaderEmail,
    filename: parsed.filename,
    fingerprint: parsed.fingerprint,
    status: "staging",
    counts,
    issueSamples: stagedRows.flatMap((row) => row.issues).slice(0, ISSUE_SAMPLE_LIMIT),
    duplicatePreviousJobId: previousJobSnap.docs[0]?.id,
    chunkCount: rowChunks.length,
    completedChunks: 0,
    createdAt: now,
    updatedAt: now,
    cleanupAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const jobRef = db.collection(COLLECTIONS.importJobs).doc(jobId);
  await jobRef.create(stripUndefinedDeep(job));
  try {
    for (let start = 0; start < rowChunks.length; start += STAGING_CHUNKS_PER_COMMIT) {
      const batch = db.batch();
      rowChunks
        .slice(start, start + STAGING_CHUNKS_PER_COMMIT)
        .forEach((rows, offset) => {
          const index = start + offset;
          const chunkId = `${jobId}-${String(index).padStart(4, "0")}`;
          const chunk: ProspectImportChunk = {
            id: chunkId,
            organizationId,
            jobId,
            index,
            status: "staged",
            rows,
            attemptCount: 0,
            createdAt: now,
            updatedAt: now,
          };
          batch.create(
            db.collection(COLLECTIONS.importJobChunks).doc(chunkId),
            stripUndefinedDeep(chunk),
          );
        });
      await batch.commit();
    }
    await jobRef.update({ status: "preview", updatedAt: new Date().toISOString() });
    return { ...job, status: "preview" };
  } catch (error) {
    await jobRef.update({
      status: "failed",
      error: error instanceof Error ? error.message : "Could not stage import chunks.",
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function getProspectImportJob(
  db: Firestore,
  organizationId: string,
  jobId: string,
): Promise<ProspectImportJob | null> {
  const snapshot = await db.collection(COLLECTIONS.importJobs).doc(jobId).get();
  if (!snapshot.exists || snapshot.data()?.organizationId !== organizationId) return null;
  const data = snapshot.data() as ProspectImportJob;
  return {
    ...data,
    id: snapshot.id,
    issueSamples: data.issueSamples ?? [],
  };
}

export async function confirmProspectImportJob(input: {
  db: Firestore;
  organizationId: string;
  uploaderId: string;
  jobId: string;
  policy: ProspectImportPolicy;
  reimportConfirmed: boolean;
}): Promise<ProspectImportJob> {
  const { db, organizationId, uploaderId, jobId, policy, reimportConfirmed } = input;
  const job = await getProspectImportJob(db, organizationId, jobId);
  if (!job) throw new Error("Import job not found.");
  if (job.uploaderId !== uploaderId) throw new Error("Only the uploader can confirm this import.");
  if (job.status !== "preview") throw new Error("This import is no longer awaiting confirmation.");
  if (job.duplicatePreviousJobId && !reimportConfirmed) throw new Error("This exact file was imported before. Confirm re-import to continue.");

  const now = new Date().toISOString();
  const chunksSnapshot = await db.collection(COLLECTIONS.importJobChunks).where("jobId", "==", jobId).get();
  const batch = db.batch();
  batch.update(db.collection(COLLECTIONS.importJobs).doc(jobId), {
    policy,
    reimportConfirmed,
    status: "queued",
    startedAt: now,
    cleanupAfter: FieldValue.delete(),
    updatedAt: now,
  });
  for (const chunkDoc of chunksSnapshot.docs) {
    batch.update(chunkDoc.ref, { status: "queued", updatedAt: now });
  }
  await batch.commit();
  return { ...job, policy, reimportConfirmed, status: "queued", startedAt: now, updatedAt: now };
}

export async function cancelProspectImportJob(input: {
  db: Firestore;
  organizationId: string;
  uploaderId: string;
  jobId: string;
  finalizeImmediately?: boolean;
}): Promise<"cancel_requested" | "cancelled"> {
  const { db, organizationId, uploaderId, jobId, finalizeImmediately = false } = input;
  const job = await getProspectImportJob(db, organizationId, jobId);
  if (!job) throw new Error("Import job not found.");
  if (job.uploaderId !== uploaderId) throw new Error("Only the uploader can cancel this import.");
  if (!["queued", "processing"].includes(job.status)) throw new Error("This import cannot be cancelled.");
  const now = new Date().toISOString();

  if (finalizeImmediately && job.status === "queued" && job.completedChunks === 0) {
    const chunksSnapshot = await db.collection(COLLECTIONS.importJobChunks)
      .where("jobId", "==", jobId)
      .get();
    const batch = db.batch();
    batch.update(db.collection(COLLECTIONS.importJobs).doc(jobId), {
      status: "cancelled",
      cancelledAt: now,
      cleanupAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: now,
    });
    for (const chunkDoc of chunksSnapshot.docs) {
      batch.update(chunkDoc.ref, { status: "cancelled", updatedAt: now });
    }
    await batch.commit();
    return "cancelled";
  }

  await db.collection(COLLECTIONS.importJobs).doc(jobId).update({
    status: "cancel_requested",
    updatedAt: now,
  });
  return "cancel_requested";
}

export async function cleanupProspectImportDetails(input: {
  db: Firestore;
  organizationId: string;
  uploaderId: string;
  jobId: string;
}): Promise<void> {
  const { db, organizationId, uploaderId, jobId } = input;
  const job = await getProspectImportJob(db, organizationId, jobId);
  if (!job) throw new Error("Import job not found.");
  if (job.uploaderId !== uploaderId) throw new Error("Only the uploader can clean this import.");
  if (
    !["preview", "completed", "completed_with_errors", "cancelled", "failed"].includes(
      job.status,
    )
  ) {
    throw new Error("A running import cannot be cleaned up.");
  }
  const [chunkSnapshot, receiptSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.importJobChunks).where("jobId", "==", jobId).get(),
    db.collection(COLLECTIONS.importIdentityKeys).where("jobId", "==", jobId).get(),
  ]);
  const ownedTemporaryDocs = [...chunkSnapshot.docs, ...receiptSnapshot.docs].filter(
    (doc) => doc.data().organizationId === organizationId,
  );
  for (const chunkBatch of chunks(ownedTemporaryDocs, 400)) {
    const batch = db.batch();
    chunkBatch.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  await db.collection(COLLECTIONS.importJobs).doc(jobId).update({
    issueSamples: FieldValue.delete(),
    cleanupAfter: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function buildProspectImportRejectionCsv(
  db: Firestore,
  organizationId: string,
  jobId: string,
): Promise<string> {
  const job = await getProspectImportJob(db, organizationId, jobId);
  if (!job) throw new Error("Import job not found.");
  const snapshot = await db.collection(COLLECTIONS.importJobChunks).where("jobId", "==", jobId).get();
  const lines = ["Row,Severity,Field,Code,Message"];
  const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  for (const doc of snapshot.docs) {
    const chunk = doc.data() as ProspectImportChunk;
    for (const row of chunk.rows) {
      for (const issue of row.issues) {
        lines.push([row.rowNumber, issue.severity, issue.field ?? "", issue.code, issue.message].map(quote).join(","));
      }
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
