"use client";

import type { Account, Contact, Deal } from "@/lib/types";

type Entity = "accounts" | "contacts" | "deals";

type FetchResult<T> =
  | { status: "ok"; entity: T }
  | { status: "not_found" }
  | { status: "error"; message: string };

async function fetchCrmEntityById<T>(
  entity: Entity,
  id: string,
): Promise<FetchResult<T>> {
  const trimmed = id.trim();
  if (!trimmed) return { status: "not_found" };
  try {
    const res = await fetch(`/api/org/${entity}/${encodeURIComponent(trimmed)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.status === 404) return { status: "not_found" };
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
    } & Record<string, unknown>;
    if (!res.ok || !json.ok) {
      return { status: "error", message: json.error || `Failed to load ${entity}` };
    }
    const singular =
      entity === "accounts" ? "account" : entity === "contacts" ? "contact" : "deal";
    const row = json[singular];
    if (!row || typeof row !== "object") return { status: "not_found" };
    return { status: "ok", entity: row as T };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : `Failed to load ${entity}`,
    };
  }
}

export function fetchAccountByIdClient(accountId: string) {
  return fetchCrmEntityById<Account>("accounts", accountId);
}

export function fetchContactByIdClient(contactId: string) {
  return fetchCrmEntityById<Contact>("contacts", contactId);
}

export function fetchDealByIdClient(dealId: string) {
  return fetchCrmEntityById<Deal>("deals", dealId);
}
