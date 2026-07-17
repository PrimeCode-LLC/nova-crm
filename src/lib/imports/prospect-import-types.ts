import type {
  NormalizedProspectImportRow,
} from "@/lib/imports/prospect-import-schema";
import type { ProspectImportIssue } from "@/lib/imports/prospect-import-parse";

export type ProspectImportPolicy = "add_new" | "update_non_empty" | "replace";

export type ProspectImportJobStatus =
  | "staging"
  | "preview"
  | "queued"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "cancel_requested"
  | "cancelled"
  | "failed";

export type ProspectImportCounts = {
  total: number;
  valid: number;
  invalid: number;
  warnings: number;
  inFileDuplicates: number;
  existingContacts: number;
  existingProspects: number;
  ambiguousProspects: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  processed: number;
};

export type ProspectImportJob = {
  id: string;
  organizationId: string;
  uploaderId: string;
  uploaderEmail?: string;
  filename: string;
  fingerprint: string;
  status: ProspectImportJobStatus;
  policy?: ProspectImportPolicy;
  counts: ProspectImportCounts;
  issueSamples: ProspectImportIssue[];
  duplicatePreviousJobId?: string;
  reimportConfirmed?: boolean;
  chunkCount: number;
  completedChunks: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cleanupAfter?: string;
  error?: string;
};

export type StagedProspectImportRow = {
  rowNumber: number;
  normalized: NormalizedProspectImportRow;
  issues: ProspectImportIssue[];
  identity: string;
  existingAccountId?: string;
  existingContactId?: string;
  existingProspectIds: string[];
};

export type ProspectImportChunk = {
  id: string;
  organizationId: string;
  jobId: string;
  index: number;
  status: "staged" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  rows: StagedProspectImportRow[];
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export const EMPTY_IMPORT_COUNTS: ProspectImportCounts = {
  total: 0,
  valid: 0,
  invalid: 0,
  warnings: 0,
  inFileDuplicates: 0,
  existingContacts: 0,
  existingProspects: 0,
  ambiguousProspects: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  processed: 0,
};
