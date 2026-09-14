import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import {
  PROSPECT_IMPORT_DATA_SHEET,
  PROSPECT_IMPORT_FIELDS,
  PROSPECT_IMPORT_HEADERS,
  PROSPECT_IMPORT_MAX_BYTES,
  PROSPECT_IMPORT_MAX_ROWS,
  type NormalizedProspectImportRow,
  type ProspectImportField,
  type ProspectImportFieldKey,
} from "@/lib/imports/prospect-import-schema";
import { domainFromWebsiteOrEmail } from "@/lib/prospects/prospect-form";

export type ImportIssueSeverity = "error" | "warning";

export type ProspectImportIssue = {
  rowNumber: number;
  field?: string;
  severity: ImportIssueSeverity;
  code: string;
  message: string;
};

export type ParsedProspectImportRow = {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: NormalizedProspectImportRow;
  issues: ProspectImportIssue[];
};

export type ParsedProspectImport = {
  filename: string;
  fingerprint: string;
  rows: ParsedProspectImportRow[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const enumAliases: Record<string, string> = {
  lead: "prospect",
  prospect: "prospect",
  email: "cold_email",
  "cold email": "cold_email",
  "personalized email": "personalized_email",
  "1 1 email": "personalized_email",
  linkedin: "linkedin_outbound",
  "linkedin outbound": "linkedin_outbound",
  "linkedin 1 1": "linkedin_1to1",
  "website form": "website_form",
  active: "active",
  new: "new",
  dormant: "dormant",
  live: "live",
  "under construction": "under_construction",
  none: "none",
  "not verified": "not_verified",
  verified: "verified",
  bounced: "bounced",
  "catch all": "catch_all",
  "valid catch all": "catch_all",
  form: "form",
  open: "open",
  cold: "cold",
  warm: "warm",
  hot: "hot",
  low: "low",
  medium: "medium",
  high: "high",
  urgent: "urgent",
  "not ready": "not_ready",
  ready: "ready",
  pushed: "pushed",
  "do not push": "do_not_push",
  "< 1m": "lt_1m",
  "1m 10m": "1m_10m",
  "10m 50m": "10m_50m",
  "50m 100m": "50m_100m",
  "20m 50m": "10m_50m",
  "100m 200m": "100m_500m",
  "200m 500m": "100m_500m",
  "100m 500m": "100m_500m",
  "500m 800m": "500m_1b",
  "500m 1b": "500m_1b",
  "> 1b": "gt_1b",
  "1b": "gt_1b",
  "2 10": "1-10",
  "500": "501-1000",
  "5000": "5001+",
  unknown: "unknown",
  incomplete: "incomplete",
  completed: "completed",
  rejected: "rejected",
};

function compactKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[$€£]/g, "")
    .replace(/[^a-z0-9<>]+/g, " ")
    .trim();
}

function looksLikeUrl(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return (
    /^https?:\/\//i.test(text) ||
    /^www\./i.test(text) ||
    /^[\w.-]+\.[a-z]{2,}([/:?]|$)/i.test(text)
  );
}

function normalizeHeaderLabel(value: string): string {
  return value.replace(/\u00a0/g, " ").trim();
}

function stringValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "object") {
    const record = value as unknown as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return (record.richText as Array<{ text?: unknown }>)
        .map((part) => String(part.text ?? ""))
        .join("")
        .trim();
    }
    if ("result" in record && record.result != null) {
      const fromResult = stringValue(record.result);
      if (fromResult) return fromResult;
    }
    if (typeof record.text === "string" || typeof record.text === "number") {
      return String(record.text).trim();
    }
    if (typeof record.hyperlink === "string" && record.hyperlink.trim()) {
      return record.hyperlink.trim();
    }
    if (typeof record.formula === "string") {
      const hyperlinkMatch = record.formula.match(
        /^HYPERLINK\(\s*"([^"]+)"(?:\s*,\s*"([^"]*)")?\s*\)$/i,
      );
      if (hyperlinkMatch) {
        const url = (hyperlinkMatch[1] || "").trim();
        const label = (hyperlinkMatch[2] || "").trim();
        if (label && looksLikeUrl(label)) return label;
        return url || label;
      }
    }
    if ("text" in record) {
      return String(record.text ?? "").trim();
    }
  }
  return String(value).trim();
}

/** Prefer display/result values so Excel HYPERLINK formulas do not abort the upload. */
function excelCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value !== "object") return value;
  const record = value as unknown as Record<string, unknown>;
  if ("formula" in record || "sharedFormula" in record) {
    if (record.result != null) return record.result;
    const asText = stringValue(value);
    if (asText) return asText;
    return undefined;
  }
  if ("hyperlink" in record) {
    const text =
      typeof record.text === "string" || typeof record.text === "number"
        ? String(record.text).trim()
        : "";
    const link = typeof record.hyperlink === "string" ? record.hyperlink.trim() : "";
    // Prefer the real URL when Excel shows a friendly label as the cell text.
    if (text && looksLikeUrl(text)) return text;
    if (link) return link;
    return text;
  }
  if (Array.isArray(record.richText)) {
    return stringValue(value);
  }
  return value;
}

function headersMatchOfficial(headers: string[]): boolean {
  return (
    headers.length === PROSPECT_IMPORT_HEADERS.length &&
    headers.every(
      (header, index) => normalizeHeaderLabel(header) === PROSPECT_IMPORT_HEADERS[index],
    )
  );
}

function readSheetHeaders(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  return PROSPECT_IMPORT_HEADERS.map((_, index) =>
    normalizeHeaderLabel(stringValue(excelCellValue(sheet.getCell(rowNumber, index + 1)))),
  );
}

function findImportSheet(workbook: ExcelJS.Workbook): {
  sheet: ExcelJS.Worksheet;
  headerRow: number;
} {
  const namedData = workbook.getWorksheet(PROSPECT_IMPORT_DATA_SHEET);
  const candidates = namedData
    ? [namedData, ...workbook.worksheets.filter((sheet) => sheet !== namedData)]
    : workbook.worksheets;

  for (const sheet of candidates) {
    for (const headerRow of [2, 1] as const) {
      const headers = readSheetHeaders(sheet, headerRow);
      if (headersMatchOfficial(headers)) {
        return { sheet, headerRow };
      }
    }
  }

  const attempted =
    namedData != null
      ? readSheetHeaders(namedData, 2)
      : readSheetHeaders(workbook.worksheets[0]!, 1);
  assertExactHeaders(attempted);
  throw new Error(
    `Could not find the official header row. Download the XLSX template from Import Prospects and keep the ${PROSPECT_IMPORT_HEADERS.length} column names unchanged.`,
  );
}

function normalizeDomain(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return hostname.includes(".") ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function normalizeUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (!parsed.hostname.includes(".")) return undefined;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function excelSerialDateToIso(serial: number): string | undefined {
  // Excel's day-zero is 1899-12-30 (with the legacy 1900 leap-year bug).
  if (!Number.isFinite(serial) || serial < 1 || serial > 100_000) return undefined;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function normalizeDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    return excelSerialDateToIso(value);
  }
  const text = stringValue(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T12:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text) return text;
  }
  const asNumber = Number(text);
  if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(text)) {
    const fromSerial = excelSerialDateToIso(asNumber);
    if (fromSerial) return fromSerial;
  }
  const namedDate = text.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})$/i,
  );
  if (namedDate) {
    const months = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];
    const month = months.indexOf(namedDate[1]!.toLowerCase());
    const day = Number(namedDate[2]);
    const year = Number(namedDate[3]);
    const date = new Date(Date.UTC(year, month, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month &&
      date.getUTCDate() === day
    ) {
      return date.toISOString().slice(0, 10);
    }
  }
  return undefined;
}

function normalizeEnum(value: string, values: readonly string[]): string | undefined {
  if (!value) return undefined;
  if (values.includes(value)) return value;
  const compact = compactKey(value);
  const aliased = enumAliases[compact];
  if (aliased && values.includes(aliased)) return aliased;
  return values.find((candidate) => compactKey(candidate) === compact);
}

function normalizeBoolean(value: string): boolean | undefined {
  if (!value) return undefined;
  const compact = compactKey(value);
  if (["true", "yes", "y", "1", "verified", "valid"].includes(compact)) return true;
  if (["false", "no", "n", "0", "not verified", "unverified"].includes(compact)) return false;
  return undefined;
}

function addIssue(
  issues: ProspectImportIssue[],
  rowNumber: number,
  field: ProspectImportField,
  code: string,
  message: string,
): void {
  issues.push({ rowNumber, field: field.header, severity: "error", code, message });
}

function normalizeField(
  field: ProspectImportField,
  raw: unknown,
  rowNumber: number,
  issues: ProspectImportIssue[],
): unknown {
  const text = stringValue(raw);
  if (!text) return undefined;
  if (text.length > 10_000) {
    addIssue(issues, rowNumber, field, "value_too_long", `${field.header} exceeds 10,000 characters.`);
    return undefined;
  }
  if (
    (text.startsWith("=") || text.startsWith("+") || text.startsWith("@")) &&
    field.type !== "number" &&
    field.key !== "phone"
  ) {
    addIssue(issues, rowNumber, field, "formula_like_value", `${field.header} cannot start with a spreadsheet formula character.`);
    return undefined;
  }

  switch (field.type) {
    case "text":
      return text;
    case "email": {
      const email = text.toLowerCase();
      if (!EMAIL_RE.test(email)) {
        addIssue(issues, rowNumber, field, "invalid_email", `${field.header} is not a valid email.`);
        return undefined;
      }
      return email;
    }
    case "domain": {
      const domain = normalizeDomain(text);
      if (!domain) addIssue(issues, rowNumber, field, "invalid_domain", `${field.header} is not a valid domain.`);
      return domain;
    }
    case "url": {
      const url = normalizeUrl(text);
      if (!url) addIssue(issues, rowNumber, field, "invalid_url", `${field.header} must be a complete HTTP(S) URL.`);
      return url;
    }
    case "integer":
    case "number": {
      const number = Number(text.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) {
        addIssue(issues, rowNumber, field, "invalid_number", `${field.header} must be a valid ${field.type}.`);
        return undefined;
      }
      return number;
    }
    case "boolean": {
      const bool = normalizeBoolean(text);
      if (bool === undefined) addIssue(issues, rowNumber, field, "invalid_boolean", `${field.header} must be true or false.`);
      return bool;
    }
    case "date": {
      const date = normalizeDate(raw);
      if (!date) addIssue(issues, rowNumber, field, "invalid_date", `${field.header} must use YYYY-MM-DD.`);
      return date;
    }
    case "enum": {
      const value = normalizeEnum(text, field.values ?? []);
      if (!value) {
        addIssue(issues, rowNumber, field, "invalid_enum", `${field.header} is not an allowed value.`);
      }
      return value;
    }
    case "list":
      return [...new Set(text.split(text.includes(";") ? ";" : ",").map((item) => item.trim()).filter(Boolean))];
    case "json": {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed === null || typeof parsed !== "object") throw new Error("object required");
        return parsed;
      } catch {
        addIssue(
          issues,
          rowNumber,
          field,
          "invalid_json",
          `${field.header} must contain valid JSON (object or array).`,
        );
        return undefined;
      }
    }
  }
}

function deriveCompanyDomain(normalized: NormalizedProspectImportRow): string | undefined {
  if (typeof normalized.companyDomain === "string" && normalized.companyDomain) {
    return normalized.companyDomain;
  }
  const website = typeof normalized.website === "string" ? normalized.website : "";
  const email = typeof normalized.companyEmail === "string" ? normalized.companyEmail : "";
  return domainFromWebsiteOrEmail(website, email);
}

function validateBusinessRules(
  rowNumber: number,
  normalized: NormalizedProspectImportRow,
  issues: ProspectImportIssue[],
): void {
  for (const field of PROSPECT_IMPORT_FIELDS) {
    if (field.required && normalized[field.key as ProspectImportFieldKey] == null) {
      issues.push({
        rowNumber,
        field: field.header,
        severity: "error",
        code: "required",
        message: `${field.header} is required.`,
      });
    }
  }

  if (!normalized.companyDomain) {
    issues.push({
      rowNumber,
      field: "Company Domain",
      severity: "error",
      code: "domain_required",
      message:
        "Company Domain is required (or provide Website URL / Company Email so it can be derived).",
    });
  }

  if (
    !normalized.companyEmail &&
    !normalized.personalEmail &&
    !normalized.contactLinkedIn &&
    !normalized.phone
  ) {
    issues.push({
      rowNumber,
      severity: "error",
      code: "contact_identity_required",
      message: "Provide at least one email, Contact LinkedIn URL, or Phone.",
    });
  }

  const year = normalized.yearFounded;
  if (typeof year === "number" && (year < 1800 || year > new Date().getFullYear() + 1)) {
    issues.push({ rowNumber, field: "Year Founded", severity: "error", code: "invalid_year", message: "Year Founded is outside the supported range." });
  }
  if (
    normalized.companyEmail &&
    normalized.personalEmail &&
    normalized.companyEmail === normalized.personalEmail
  ) {
    issues.push({ rowNumber, field: "Personal Email", severity: "error", code: "duplicate_emails", message: "Company Email and Personal Email must differ." });
  }
  if (normalized.prospectQualifyStatus === "rejected" && !normalized.rejectionReason) {
    issues.push({
      rowNumber,
      field: "Rejection Reason",
      severity: "error",
      code: "rejection_reason_required",
      message: "Rejection Reason is required when Qualify Status is rejected.",
    });
  }
  if (normalized.intentEvidence != null && !Array.isArray(normalized.intentEvidence)) {
    issues.push({
      rowNumber,
      field: "Intent Evidence JSON",
      severity: "error",
      code: "invalid_intent_evidence",
      message: "Intent Evidence JSON must be a JSON array.",
    });
  }
}

function normalizeRawRow(rowNumber: number, raw: Record<string, unknown>): ParsedProspectImportRow {
  const normalized: NormalizedProspectImportRow = {};
  const issues: ProspectImportIssue[] = [];
  for (const field of PROSPECT_IMPORT_FIELDS) {
    const value = normalizeField(field, raw[field.header], rowNumber, issues);
    if (value !== undefined) normalized[field.key as ProspectImportFieldKey] = value;
  }
  const derivedDomain = deriveCompanyDomain(normalized);
  if (derivedDomain) normalized.companyDomain = derivedDomain;
  validateBusinessRules(rowNumber, normalized, issues);
  return { rowNumber, raw, normalized, issues };
}

function assertExactHeaders(headers: string[]): void {
  const nonEmpty = headers.filter(Boolean);
  if (nonEmpty.length === 0) {
    throw new Error(
      `Could not find the official header row. Download the XLSX template from Import Prospects and keep the ${PROSPECT_IMPORT_HEADERS.length} column names unchanged.`,
    );
  }
  if (headers.length !== PROSPECT_IMPORT_HEADERS.length) {
    throw new Error(`Template has ${headers.length} columns; expected ${PROSPECT_IMPORT_HEADERS.length}.`);
  }
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    throw new Error(`Template contains duplicate headers: ${[...new Set(duplicateHeaders)].join(", ")}.`);
  }
  for (let index = 0; index < PROSPECT_IMPORT_HEADERS.length; index++) {
    if (normalizeHeaderLabel(headers[index] ?? "") !== PROSPECT_IMPORT_HEADERS[index]) {
      const found = headers[index] ? `"${headers[index]}"` : "(blank)";
      throw new Error(
        `Column ${index + 1} must be "${PROSPECT_IMPORT_HEADERS[index]}", found ${found}. Download the official template and do not rename columns.`,
      );
    }
  }
}

async function parseXlsx(buffer: Buffer): Promise<ParsedProspectImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    throw new Error(
      "Could not read this Excel file. Upload an .xlsx file from the official Import Prospects template (not .xls or a corrupted export).",
    );
  }
  if (!workbook.worksheets.length) {
    throw new Error("Workbook has no sheets.");
  }

  const { sheet, headerRow } = findImportSheet(workbook);
  const dataStartRow = headerRow + 1;
  const rows: ParsedProspectImportRow[] = [];
  const dimensionBottom =
    typeof sheet.dimensions?.bottom === "number" ? sheet.dimensions.bottom : 0;
  const lastRow = Math.min(
    Math.max(sheet.actualRowCount || 0, sheet.rowCount || 0, dimensionBottom, headerRow),
    PROSPECT_IMPORT_MAX_ROWS + headerRow,
  );
  for (let rowNumber = dataStartRow; rowNumber <= lastRow; rowNumber++) {
    const raw: Record<string, unknown> = {};
    let hasValue = false;
    for (let index = 0; index < PROSPECT_IMPORT_HEADERS.length; index++) {
      const header = PROSPECT_IMPORT_HEADERS[index]!;
      const cell = sheet.getCell(rowNumber, index + 1);
      const value = excelCellValue(cell);
      if (
        value === undefined &&
        cell.value &&
        typeof cell.value === "object" &&
        ("formula" in cell.value || "sharedFormula" in cell.value)
      ) {
        throw new Error(
          `Formulas are not allowed (row ${rowNumber}, ${header}). Paste values instead of formulas.`,
        );
      }
      raw[header] = value ?? "";
      if (stringValue(value)) hasValue = true;
    }
    if (hasValue) rows.push(normalizeRawRow(rowNumber, raw));
  }
  if (Math.max(sheet.actualRowCount || 0, dimensionBottom) > PROSPECT_IMPORT_MAX_ROWS + headerRow) {
    throw new Error(`Workbook exceeds the ${PROSPECT_IMPORT_MAX_ROWS.toLocaleString()} row limit.`);
  }
  return rows;
}

function parseCsv(buffer: Buffer): ParsedProspectImportRow[] {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length) throw new Error(parsed.errors[0]!.message);

  const csvRows = parsed.data.map((row) => row.map((value) => String(value ?? "").trim()));
  const exactHeaderAt = (index: number) => {
    const row = csvRows[index] ?? [];
    const headers = row.slice(0, PROSPECT_IMPORT_HEADERS.length).map(normalizeHeaderLabel);
    const extras = row.slice(PROSPECT_IMPORT_HEADERS.length).filter(Boolean);
    return (
      extras.length === 0 &&
      headers.length === PROSPECT_IMPORT_HEADERS.length &&
      headers.every((header, column) => header === PROSPECT_IMPORT_HEADERS[column])
    );
  };
  const headerIndex = exactHeaderAt(0) ? 0 : exactHeaderAt(1) ? 1 : -1;
  if (headerIndex < 0) {
    const attempted = (csvRows[0] ?? []).slice(0, PROSPECT_IMPORT_HEADERS.length);
    assertExactHeaders(attempted);
    throw new Error("CSV does not contain the official header row.");
  }

  const dataRows = csvRows.slice(headerIndex + 1);
  if (dataRows.length > PROSPECT_IMPORT_MAX_ROWS) {
    throw new Error(`CSV exceeds the ${PROSPECT_IMPORT_MAX_ROWS.toLocaleString()} row limit.`);
  }
  const rows: ParsedProspectImportRow[] = [];
  for (let index = 0; index < dataRows.length; index++) {
    const values = dataRows[index]!;
    const extraValues = values.slice(PROSPECT_IMPORT_HEADERS.length).filter(Boolean);
    if (extraValues.length) {
      throw new Error(`CSV row ${headerIndex + index + 2} has unexpected extra columns.`);
    }
    const raw = Object.fromEntries(
      PROSPECT_IMPORT_HEADERS.map((header, column) => [header, values[column] ?? ""]),
    );
    const hasValue = PROSPECT_IMPORT_HEADERS.some((header) => stringValue(raw[header]));
    if (!hasValue) continue;
    rows.push(normalizeRawRow(headerIndex + index + 2, raw));
  }
  return rows;
}

export async function parseProspectImportFile(
  filename: string,
  buffer: Buffer,
): Promise<ParsedProspectImport> {
  if (buffer.byteLength > PROSPECT_IMPORT_MAX_BYTES) throw new Error("File exceeds the 20 MB limit.");
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
    throw new Error("Only the official XLSX template or its CSV export is supported.");
  }
  const rows = lower.endsWith(".xlsx") ? await parseXlsx(buffer) : parseCsv(buffer);
  if (!rows.length) throw new Error("The template contains no data rows.");
  return {
    filename,
    fingerprint: createHash("sha256").update(buffer).digest("hex"),
    rows,
  };
}
