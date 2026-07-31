import ExcelJS from "exceljs";
import { resolveEmailVerificationStatus } from "@/lib/email/email-verification-status";
import {
  PROSPECT_IMPORT_DATA_SHEET,
  PROSPECT_IMPORT_FIELDS,
  PROSPECT_IMPORT_HEADERS,
  PROSPECT_IMPORT_TEMPLATE_VERSION,
  type ProspectImportFieldKey,
} from "@/lib/imports/prospect-import-schema";
import type { Account, Contact, Lead } from "@/lib/types";

export type ProspectExportLookups = {
  getAccountById: (id: string) => Account | undefined;
  getContactById: (id: string) => Contact | undefined;
  /** Outreach profile display name (or id). Import accepts name or id. */
  getProfileName?: (profileId?: string) => string | undefined;
  /** Prospecting strategy display name (or id). Import accepts name or id. */
  getStrategyName?: (strategyId?: string) => string | undefined;
  /** Buyer persona display name (or id). Import accepts name or id. */
  getPersonaName?: (personaId?: string) => string | undefined;
};

export type ProspectExportRow = Record<ProspectImportFieldKey, string>;

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

function asDateYmd(value: string | undefined): string {
  if (!value) return "";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "";
}

function splitContactName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function techStackCell(stack: string[] | undefined): string {
  if (!stack?.length) return "";
  return stack.map((item) => item.trim()).filter(Boolean).join("; ");
}

function intentEvidenceCell(evidence: Lead["intentEvidence"]): string {
  if (!evidence?.length) return "";
  try {
    return JSON.stringify(evidence);
  } catch {
    return "";
  }
}

/**
 * Map a CRM lead (+ related account/contact) to one official import-template row.
 * Cell values use the same keys/headers as bulk import and the New prospect form.
 */
export function leadToProspectExportRow(
  lead: Lead,
  lookups: ProspectExportLookups,
): ProspectExportRow {
  const account = lookups.getAccountById(lead.accountId);
  const contact = lookups.getContactById(lead.contactId);
  const nameFromLead = splitContactName(lead.contactName ?? "");
  const emailStatus = resolveEmailVerificationStatus(contact, lead);
  const note = lead.personalizationNote;

  const cells: ProspectExportRow = {
    companyName: asText(account?.name ?? lead.companyName),
    companyDomain: asText(account?.domain ?? lead.companyDomain),
    industry: asText(account?.industry ?? lead.companyIndustry),
    businessDescription: asText(account?.businessDescription),
    city: asText(account?.city),
    state: asText(account?.state),
    country: asText(account?.country),
    website: asText(account?.website),
    companyLinkedIn: asText(account?.linkedin),
    yearFounded: asText(account?.yearFounded),
    businessStatus: asText(account?.businessStatus),
    companySize: asText(account?.size ?? lead.companySize),
    revenueRange: asText(account?.revenueRange ?? lead.revenueRange),
    websiteStatus: asText(account?.websiteStatus),
    onlineActivityScore: asText(account?.onlineActivityScore),
    lastWebsiteActivityAt: asDateYmd(account?.lastWebsiteActivityAt),
    lastWebsiteActivityNote: asText(account?.lastWebsiteActivityNote),
    techStack: techStackCell(account?.techStack),
    careersPageUrl: asText(account?.careersPageUrl),

    firstName: asText(contact?.firstName || nameFromLead.firstName),
    lastName: asText(contact?.lastName || nameFromLead.lastName),
    jobTitle: asText(contact?.title ?? lead.contactTitle),
    seniority: asText(contact?.seniority),
    contactLocation: asText(contact?.location),
    companyEmail: asText(contact?.email ?? lead.contactEmail),
    personalEmail: asText(contact?.personalEmail),
    emailVerificationStatus: asText(emailStatus),
    phone: asText(contact?.phone),
    contactSource: asText(contact?.contactSource),
    bestContactChannel: asText(contact?.bestContactChannel),
    contactLinkedIn: asText(contact?.linkedin ?? lead.contactLinkedIn),

    strategy: asText(
      (lead.strategyId && lookups.getStrategyName?.(lead.strategyId)) || lead.strategyId,
    ),
    persona: asText(
      (lead.personaId && lookups.getPersonaName?.(lead.personaId)) || lead.personaId,
    ),
    channel: asText(lead.channel),
    profile: asText(
      (lead.profileId && lookups.getProfileName?.(lead.profileId)) || lead.profileId,
    ),
    stage: asText(lead.stage),
    temperature: asText(lead.temperature),
    priority: asText(lead.priority),
    nextAction: asText(lead.nextAction),
    notes: asText(lead.notes),

    triggerEvent: asText(lead.triggerEvent),
    painPoints: asText(lead.painPoints),
    doNotContact: lead.doNotContact == null ? "" : lead.doNotContact ? "true" : "false",

    personalizationTrigger: asText(note?.trigger),
    personalizationLikelyImpact: asText(note?.likelyImpact),
    personalizationRelevantService: asText(note?.relevantService),
    personalizationSuggestedAngle: asText(note?.suggestedAngle),
    primaryOpportunityLabel: asText(lead.primaryOpportunityLabel),
    deeplyPersonalized:
      lead.deeplyPersonalized == null ? "" : lead.deeplyPersonalized ? "true" : "false",
    prospectQualifyStatus: asText(lead.prospectQualifyStatus),
    rejectionReason: asText(lead.rejectionReason),
    rejectionNote: asText(lead.rejectionNote),
    intentEvidence: intentEvidenceCell(lead.intentEvidence),
  };

  return cells;
}

export function leadsToProspectExportRows(
  leads: readonly Lead[],
  lookups: ProspectExportLookups,
): ProspectExportRow[] {
  return leads.map((lead) => leadToProspectExportRow(lead, lookups));
}

/** CSV with exact import headers (row 1) — re-importable via bulk import. */
export function buildProspectExportCsv(rows: readonly ProspectExportRow[]): string {
  const lines = [
    PROSPECT_IMPORT_HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      PROSPECT_IMPORT_FIELDS.map((field) => csvCell(row[field.key as ProspectImportFieldKey] ?? "")).join(
        ",",
      ),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * XLSX matching the official import template layout:
 * Data (section row + headers + values), Instructions, Allowed Values.
 */
export async function buildProspectExportWorkbook(
  rows: readonly ProspectExportRow[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nova CRM";
  workbook.title = "Nova CRM Prospect Export";
  workbook.subject = `Prospect export compatible with import template ${PROSPECT_IMPORT_TEMPLATE_VERSION}`;
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet(PROSPECT_IMPORT_DATA_SHEET);

  // Section row (same as import template)
  let start = 1;
  let current = PROSPECT_IMPORT_FIELDS[0]!.section;
  for (let index = 1; index <= PROSPECT_IMPORT_FIELDS.length; index++) {
    const next = PROSPECT_IMPORT_FIELDS[index]?.section;
    if (next !== current) {
      sheet.mergeCells(1, start, 1, index);
      const cell = sheet.getCell(1, start);
      cell.value = current;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { bold: true };
      start = index + 1;
      current = next ?? current;
    }
  }

  const header = sheet.getRow(2);
  header.values = PROSPECT_IMPORT_HEADERS;
  header.font = { bold: true };
  header.height = 28;

  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 3);
    excelRow.values = PROSPECT_IMPORT_FIELDS.map(
      (field) => row[field.key as ProspectImportFieldKey] ?? "",
    );
  });

  PROSPECT_IMPORT_FIELDS.forEach((field, index) => {
    sheet.getColumn(index + 1).width = Math.min(34, Math.max(15, field.header.length + 3));
  });

  sheet.views = [{ state: "frozen", ySplit: 2, xSplit: 0 }];
  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: Math.max(2, rows.length + 2), column: PROSPECT_IMPORT_FIELDS.length },
  };

  const instructions = workbook.addWorksheet("Instructions");
  instructions.columns = [{ width: 28 }, { width: 100 }];
  instructions.addRow(["Nova Prospect Export", `Compatible with import template ${PROSPECT_IMPORT_TEMPLATE_VERSION}`]);
  instructions.addRow(["Rows", rows.length]);
  instructions.addRow([
    "Re-import",
    "Upload this file on Admin → Import. Columns match the New prospect form and the official import template.",
  ]);
  instructions.addRow(["Do not modify", "Do not rename, add, remove, merge, or reorder Data sheet columns."]);
  instructions.getRow(1).font = { bold: true, size: 14 };

  const allowed = workbook.addWorksheet("Allowed Values");
  allowed.columns = [
    { header: "Column", key: "column", width: 34 },
    { header: "Allowed values", key: "values", width: 100 },
    { header: "Description", key: "description", width: 80 },
  ];
  for (const field of PROSPECT_IMPORT_FIELDS) {
    allowed.addRow({
      column: field.header,
      values: field.values?.join("; ") ?? (field.type === "boolean" ? "true; false" : ""),
      description: field.description,
    });
  }
  allowed.getRow(1).font = { bold: true };

  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function downloadProspectExportCsv(
  rows: readonly ProspectExportRow[],
  basename = "Nova_Prospect_Export",
): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([buildProspectExportCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${basename}-${stamp()}.csv`;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadProspectExportXlsx(
  rows: readonly ProspectExportRow[],
  basename = "Nova_Prospect_Export",
): Promise<void> {
  if (typeof window === "undefined") return;
  const bytes = await buildProspectExportWorkbook(rows);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${basename}-${stamp()}.xlsx`;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}
