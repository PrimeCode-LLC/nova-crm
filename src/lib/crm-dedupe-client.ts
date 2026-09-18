"use client";

import {
  normalizeCompanyDomainKey,
  normalizeWorkspaceEmail,
} from "@/lib/crm-dedupe";
import type { Account, Contact } from "@/lib/types";

/** Phase 4 — server dedupe so quick-add does not depend on a full workspace snapshot. */
export async function fetchCrmDedupeClient(input: {
  email?: string;
  domain?: string;
}): Promise<{ contact: Contact | null; account: Account | null }> {
  const email = input.email ? normalizeWorkspaceEmail(input.email) : "";
  const domain = input.domain ? normalizeCompanyDomainKey(input.domain) : "";
  if (!email && !domain) return { contact: null, account: null };

  const res = await fetch("/api/org/crm-dedupe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email || undefined, domain: domain || undefined }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    contact?: Contact | null;
    account?: Account | null;
  };
  if (!res.ok || !json.ok) return { contact: null, account: null };
  return {
    contact: json.contact ?? null,
    account: json.account ?? null,
  };
}

export async function resolveLeadIdsByEmailClient(
  emails: string[],
): Promise<Record<string, string>> {
  const cleaned = emails.map(normalizeWorkspaceEmail).filter(Boolean).slice(0, 100);
  if (!cleaned.length) return {};
  const res = await fetch("/api/org/leads/resolve-by-email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails: cleaned }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    byEmail?: Record<string, string>;
  };
  if (!res.ok || !json.ok) return {};
  return json.byEmail ?? {};
}
