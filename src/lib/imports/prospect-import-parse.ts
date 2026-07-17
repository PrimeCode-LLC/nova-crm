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
};

function compactKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[$€£]/g, "")
    .replace(/[^a-z0-9<>]+/g, " ")
    .trim();
}

function stringValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object" && "text" in value) {
    return String((value as { text?: unknown }).text ?? "").trim();
  }
  return String(value).trim();
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
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = stringValue(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T12:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text) return text;
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
  if ((text.startsWith("=") || text.startsWith("+") || text.startsWith("@")) && field.type !== "number") {
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
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
        return parsed;
      } catch {
        addIssue(issues, rowNumber, field, "invalid_json", `${field.header} must contain a JSON object.`);
        return undefined;
      }
    }
  }
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
  for (const key of ["bantBudget", "bantAuthority", "bantNeed", "bantTimeline"] as const) {
    const value = normalized[key];
    if (typeof value === "number" && (value < 1 || value > 5)) {
      issues.push({ rowNumber, field: PROSPECT_IMPORT_FIELDS.find((field) => field.key === key)?.header, severity: "error", code: "invalid_bant", message: "BANT scores must be between 1 and 5." });
    }
  }
  for (const key of ["estimatedValue", "responseTimeMinutes", "touches", "idleDays"] as const) {
    const value = normalized[key];
    if (typeof value === "number" && value < 0) {
      issues.push({ rowNumber, field: PROSPECT_IMPORT_FIELDS.find((field) => field.key === key)?.header, severity: "error", code: "negative_value", message: "This value cannot be negative." });
    }
  }
  if (
    normalized.companyEmail &&
    normalized.personalEmail &&
    normalized.companyEmail === normalized.personalEmail
  ) {
    issues.push({ rowNumber, field: "Personal Email", severity: "error", code: "duplicate_emails", message: "Company Email and Personal Email must differ." });
  }
}

function normalizeRawRow(rowNumber: number, raw: Record<string, unknown>): ParsedProspectImportRow {
  const normalized: NormalizedProspectImportRow = {};
  const issues: ProspectImportIssue[] = [];
  for (const field of PROSPECT_IMPORT_FIELDS) {
    const value = normalizeField(field, raw[field.header], rowNumber, issues);
    if (value !== undefined) normalized[field.key as ProspectImportFieldKey] = value;
  }
  normalized.recordType = "prospect";
  if (
    typeof normalized.emailVerified === "boolean" &&
    !normalized.emailVerificationStatus
  ) {
    normalized.emailVerificationStatus = normalized.emailVerified
      ? "verified"
      : "not_verified";
  } else if (
    typeof normalized.emailVerificationStatus === "string" &&
    normalized.emailVerified === undefined
  ) {
    normalized.emailVerified = normalized.emailVerificationStatus === "verified";
  }
  validateBusinessRules(rowNumber, normalized, issues);
  return { rowNumber, raw, normalized, issues };
}

function assertExactHeaders(headers: string[]): void {
  if (headers.length !== PROSPECT_IMPORT_HEADERS.length) {
    throw new Error(`Template has ${headers.length} columns; expected ${PROSPECT_IMPORT_HEADERS.length}.`);
  }
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) throw new Error(`Template contains duplicate headers: ${[...new Set(duplicateHeaders)].join(", ")}.`);
  for (let index = 0; index < PROSPECT_IMPORT_HEADERS.length; index++) {
    if (headers[index] !== PROSPECT_IMPORT_HEADERS[index]) {
      throw new Error(`Column ${index + 1} must be "${PROSPECT_IMPORT_HEADERS[index]}".`);
    }
  }
}

async function parseXlsx(buffer: Buffer): Promise<ParsedProspectImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const expectedSheets = [PROSPECT_IMPORT_DATA_SHEET, "Instructions", "Allowed Values"];
  const actualSheets = workbook.worksheets.map((worksheet) => worksheet.name);
  if (
    actualSheets.length !== expectedSheets.length ||
    expectedSheets.some((name, index) => actualSheets[index] !== name)
  ) {
    throw new Error(`Workbook sheets must be exactly: ${expectedSheets.join(", ")}.`);
  }
  const sheet = workbook.getWorksheet(PROSPECT_IMPORT_DATA_SHEET);
  if (!sheet) throw new Error(`Workbook must contain a "${PROSPECT_IMPORT_DATA_SHEET}" sheet.`);
  const headers = PROSPECT_IMPORT_HEADERS.map((_, index) => stringValue(sheet.getCell(2, index + 1).value));
  assertExactHeaders(headers);

  const rows: ParsedProspectImportRow[] = [];
  const lastRow = Math.min(sheet.actualRowCount, PROSPECT_IMPORT_MAX_ROWS + 2);
  for (let rowNumber = 3; rowNumber <= lastRow; rowNumber++) {
    const raw: Record<string, unknown> = {};
    let hasValue = false;
    for (let index = 0; index < PROSPECT_IMPORT_HEADERS.length; index++) {
      const cell = sheet.getCell(rowNumber, index + 1);
      if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === "object" && "formula" in cell.value)) {
        throw new Error(`Formulas are not allowed (row ${rowNumber}, ${PROSPECT_IMPORT_HEADERS[index]}).`);
      }
      raw[PROSPECT_IMPORT_HEADERS[index]!] = cell.value;
      if (stringValue(cell.value)) hasValue = true;
    }
    if (hasValue) rows.push(normalizeRawRow(rowNumber, raw));
  }
  if (sheet.actualRowCount > PROSPECT_IMPORT_MAX_ROWS + 2) {
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
    const headers = row.slice(0, PROSPECT_IMPORT_HEADERS.length);
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
  return dataRows.map((values, index) => {
    const extraValues = values.slice(PROSPECT_IMPORT_HEADERS.length).filter(Boolean);
    if (extraValues.length) {
      throw new Error(`CSV row ${headerIndex + index + 2} has unexpected extra columns.`);
    }
    const raw = Object.fromEntries(
      PROSPECT_IMPORT_HEADERS.map((header, column) => [header, values[column] ?? ""]),
    );
    return normalizeRawRow(headerIndex + index + 2, raw);
  });
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
