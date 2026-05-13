import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import type { Account, Contact } from "@/lib/types";

export function normalizeWorkspaceEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Canonical host for comparing company domains and email @host. */
export function normalizeCompanyDomainKey(raw: string): string {
  return normalizeMailHost(raw).toLowerCase();
}

export function findContactByEmail(contacts: Contact[], rawEmail: string): Contact | undefined {
  const key = normalizeWorkspaceEmail(rawEmail);
  if (!key) return undefined;
  return contacts.find((c) => c.email && normalizeWorkspaceEmail(c.email) === key);
}

export function findAccountByDomain(accounts: Account[], rawDomain: string): Account | undefined {
  const key = normalizeCompanyDomainKey(rawDomain);
  if (!key) return undefined;
  return accounts.find((a) => a.domain && normalizeCompanyDomainKey(a.domain) === key);
}
