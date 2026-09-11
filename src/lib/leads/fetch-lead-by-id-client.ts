"use client";

import { doc, getDoc } from "@/lib/db/document-shim/shim-client-firestore";
import { getClientDb } from "@/lib/db/document-access/client";
import { COLLECTIONS } from "@/lib/documents/collections";
import { documentTimestampToIso } from "@/lib/documents/timestamp-util";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import type { Account, Contact, Lead } from "@/lib/types";

export type FetchLeadByIdResult =
  | { status: "ok"; lead: Lead; account?: Account; contact?: Contact }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "wrong_org" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

function asAccount(id: string, raw: Record<string, unknown>): Account {
  const base = { ...raw, id } as unknown as Account;
  return {
    ...base,
    id,
    createdAt: documentTimestampToIso(raw.createdAt),
    updatedAt: documentTimestampToIso(raw.updatedAt),
  };
}

function asContact(id: string, raw: Record<string, unknown>): Contact {
  const base = { ...raw, id } as unknown as Contact;
  return {
    ...base,
    id,
    createdAt: documentTimestampToIso(raw.createdAt),
    updatedAt: documentTimestampToIso(raw.updatedAt),
    emailBouncedAt: raw.emailBouncedAt ? documentTimestampToIso(raw.emailBouncedAt) : undefined,
  };
}

function firestoreErrorCode(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    return String((e as { code: unknown }).code);
  }
  return "";
}

/**
 * Load a single lead (and related account/contact when present) by document id.
 * Used when the live workspace list snapshot has not hydrated yet (new tab / cold start).
 */
export async function fetchLeadByIdClient(input: {
  leadId: string;
  organizationId: string;
}): Promise<FetchLeadByIdResult> {
  const leadId = input.leadId.trim();
  const organizationId = input.organizationId.trim();
  if (!leadId || !organizationId) {
    return { status: "not_found" };
  }

  try {
    const db = getClientDb();
    const leadSnap = await getDoc(doc(db, COLLECTIONS.leads, leadId));
    if (!leadSnap.exists()) {
      return { status: "not_found" };
    }

    const leadRaw = leadSnap.data() as Record<string, unknown>;
    const leadOrg =
      typeof leadRaw.organizationId === "string" ? leadRaw.organizationId.trim() : "";
    if (leadOrg && leadOrg !== organizationId) {
      return { status: "wrong_org" };
    }

    const lead = mapLeadDoc(leadSnap.id, leadRaw);
    let account: Account | undefined;
    let contact: Contact | undefined;

    const accountId = lead.accountId?.trim();
    const contactId = lead.contactId?.trim();

    const [accountSnap, contactSnap] = await Promise.all([
      accountId ? getDoc(doc(db, COLLECTIONS.accounts, accountId)) : Promise.resolve(null),
      contactId ? getDoc(doc(db, COLLECTIONS.contacts, contactId)) : Promise.resolve(null),
    ]);

    if (accountSnap?.exists()) {
      const raw = accountSnap.data() as Record<string, unknown>;
      const org =
        typeof raw.organizationId === "string" ? raw.organizationId.trim() : "";
      if (!org || org === organizationId) {
        account = asAccount(accountSnap.id, raw);
      }
    }
    if (contactSnap?.exists()) {
      const raw = contactSnap.data() as Record<string, unknown>;
      const org =
        typeof raw.organizationId === "string" ? raw.organizationId.trim() : "";
      if (!org || org === organizationId) {
        contact = asContact(contactSnap.id, raw);
      }
    }

    return { status: "ok", lead, account, contact };
  } catch (e) {
    const code = firestoreErrorCode(e);
    if (code === "permission-denied") {
      return { status: "forbidden" };
    }
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not load lead",
    };
  }
}
