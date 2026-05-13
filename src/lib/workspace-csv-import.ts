import { COMPANY_SIZES } from "@/lib/constants";
import type { Account, ChannelKey, CompanySize, Contact, Lead } from "@/lib/types";

export type CsvImportTargetField =
  | "companyName"
  | "contactEmail"
  | "firstName"
  | "lastName"
  | "contactTitle"
  | "contactLinkedIn"
  | "companyIndustry"
  | "companySize"
  | "companyDomain"
  | "phone";

export type MappedImportRow = Partial<Record<CsvImportTargetField, string>>;

export function mapSpreadsheetRowToTargets(
  row: Record<string, string>,
  mappings: Record<string, string>,
): MappedImportRow {
  const out: MappedImportRow = {};
  for (const [srcCol, target] of Object.entries(mappings)) {
    if (!target || target === "skip") continue;
    const key = target as CsvImportTargetField;
    out[key] = String(row[srcCol] ?? "").trim();
  }
  return out;
}

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function parseCompanySize(raw: string | undefined): CompanySize | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (COMPANY_SIZES.includes(t as CompanySize)) return t as CompanySize;
  const lower = t.toLowerCase();
  if (lower === "solo") return "solo";
  return undefined;
}

/** Returns false if the row has no usable identity (skip silently). */
export function rowHasImportIdentity(m: MappedImportRow): boolean {
  const email = (m.contactEmail ?? "").trim();
  const company = (m.companyName ?? "").trim();
  const fn = (m.firstName ?? "").trim();
  const ln = (m.lastName ?? "").trim();
  return Boolean(email || company || (fn && ln) || fn || ln);
}

/** Builds account + contact + lead from one mapped CSV row (same shape as Quick add). */
export function buildLeadGraphFromMappedRow(
  m: MappedImportRow,
  ownerId: string,
): { account: Account; contact: Contact; lead: Lead } {
  const now = new Date().toISOString();
  const email = (m.contactEmail ?? "").trim().toLowerCase();
  const domainFromEmail = email.includes("@") ? email.split("@")[1]?.trim() : undefined;
  const companyName =
    (m.companyName ?? "").trim() ||
    (m.companyDomain ?? "").trim() ||
    domainFromEmail ||
    "Unknown company";

  const fn = (m.firstName ?? "").trim();
  const ln = (m.lastName ?? "").trim();
  let firstName = fn;
  let lastName = ln;

  if (!firstName && !lastName && email) {
    const local = email.split("@")[0] ?? "contact";
    const parts = local.split(/[._-]+/).filter(Boolean);
    firstName = parts[0]
      ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()
      : "Contact";
    lastName =
      parts.length > 1
        ? parts
            .slice(1)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(" ")
        : firstName;
  } else {
    if (!firstName) firstName = email ? (email.split("@")[0] ?? "contact") : "Contact";
    if (!lastName) lastName = firstName;
  }

  const displayName =
    firstName === lastName ? firstName : `${firstName} ${lastName}`.trim();

  const accountId = newEntityId("a");
  const contactId = newEntityId("ct");
  const leadId = newEntityId("l");

  const account: Account = {
    id: accountId,
    name: companyName,
    domain: (m.companyDomain ?? "").trim() || domainFromEmail || undefined,
    industry: (m.companyIndustry ?? "").trim() || undefined,
    size: parseCompanySize(m.companySize),
    contactCount: 0,
    leadCount: 1,
    openDealValue: 0,
    ownerId,
    createdAt: now,
    updatedAt: now,
  };

  const contact: Contact = {
    id: contactId,
    accountId,
    firstName,
    lastName,
    fullName: displayName,
    email: email || undefined,
    phone: (m.phone ?? "").trim() || undefined,
    title: (m.contactTitle ?? "").trim() || undefined,
    linkedin: (m.contactLinkedIn ?? "").trim() || undefined,
    ownerId,
    createdAt: now,
    updatedAt: now,
  };

  const lead: Lead = {
    id: leadId,
    accountId,
    contactId,
    channel: "website_form" as ChannelKey,
    stage: "new",
    temperature: "cold",
    priority: "medium",
    ownerId,
    contactName: displayName,
    contactTitle: (m.contactTitle ?? "").trim() || undefined,
    contactEmail: email || undefined,
    contactLinkedIn: (m.contactLinkedIn ?? "").trim() || undefined,
    companyName,
    companyDomain: (m.companyDomain ?? "").trim() || domainFromEmail || undefined,
    companyIndustry: (m.companyIndustry ?? "").trim() || undefined,
    companySize: parseCompanySize(m.companySize),
    touches: 0,
    isIdle: false,
    createdAt: now,
    updatedAt: now,
  };

  return { account, contact, lead };
}

/**
 * Creates account + contact + lead from one mapped CSV row (same pattern as Quick add lead).
 */
export function ingestMappedRowAsLead(
  m: MappedImportRow,
  ownerId: string,
  addAccount: (a: Account) => void,
  addContact: (c: Contact) => void,
  addLead: (l: Lead) => void,
): void {
  const { account, contact, lead } = buildLeadGraphFromMappedRow(m, ownerId);
  addAccount(account);
  addContact(contact);
  addLead(lead);
}

export function collectNormalizedEmailsFromWorkspace(
  leads: readonly { contactEmail?: string }[],
  contacts: readonly { email?: string }[],
): Set<string> {
  const s = new Set<string>();
  for (const l of leads) {
    const e = l.contactEmail?.trim().toLowerCase();
    if (e) s.add(e);
  }
  for (const c of contacts) {
    const e = c.email?.trim().toLowerCase();
    if (e) s.add(e);
  }
  return s;
}

/**
 * Selects raw rows to import according to duplicate policy.
 * - `create`: every row (including duplicate emails in file and workspace).
 * - otherwise: first row wins per email in file; skips rows whose email already exists in workspace.
 */
export function filterRowsForCsvImport(
  parsedRows: Record<string, string>[],
  mappings: Record<string, string>,
  duplicateHandling: string,
  workspaceEmails: Set<string>,
): Record<string, string>[] {
  const seenInFile = new Set<string>();
  const out: Record<string, string>[] = [];

  for (const row of parsedRows) {
    const m = mapSpreadsheetRowToTargets(row, mappings);
    if (!rowHasImportIdentity(m)) continue;

    const email = (m.contactEmail ?? "").trim().toLowerCase();

    if (duplicateHandling === "create") {
      out.push(row);
      continue;
    }

    if (email) {
      if (seenInFile.has(email)) continue;
      if (workspaceEmails.has(email)) continue;
      seenInFile.add(email);
    }

    out.push(row);
  }

  return out;
}
