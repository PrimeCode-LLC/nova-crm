/**
 * Website-form webhook → CRM prospect (QA 2.1). Uses the same entity builder
 * as the New prospect dialog and the Postgres graph writer. Idempotent per
 * email: an existing lead with that email is returned instead of a new one,
 * and ids derive from the email so concurrent duplicate posts converge.
 */

import { createHash, randomUUID } from "node:crypto";

import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { upsertLeadGraphPostgres } from "@/lib/db/crm-write-postgres";
import { findLeadIdByContactEmailPostgres } from "@/lib/db/list-crm-postgres";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { resolveOwnerManagerIdsAdmin } from "@/lib/documents/resolve-owner-manager-ids-admin";
import { buildProspectEntities, emptyProspectForm } from "@/lib/prospects/prospect-form";

export type WebsiteLeadPayload = {
  organizationId: string;
  source?: string;
  contactEmail?: string;
  contactName?: string;
  companyName?: string;
  channel?: string;
  raw?: Record<string, unknown>;
};

export type WebsiteLeadIngestResult =
  | { ok: true; leadId: string; duplicate: boolean }
  | { ok: false; error: string };

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "yandex.com",
]);

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function companyFromEmail(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain || FREE_MAIL.has(domain)) return "";
  return domain;
}

function rawMessage(raw: Record<string, unknown> | undefined): string {
  if (!raw) return "";
  for (const key of ["message", "notes", "comments", "comment", "body"]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 4000);
  }
  return "";
}

/** Owner who receives website leads: the org owner, else the first active owner/admin. */
async function resolveIntakeOwnerUid(organizationId: string): Promise<string> {
  const db = getAdminDb();
  if (!db) return "";
  const org = await db.collection(COLLECTIONS.organizations).doc(organizationId).get();
  const ownerUid = String(org.data()?.ownerUid ?? "").trim();
  if (ownerUid) return ownerUid;
  const members = await db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .get();
  const active = members.docs
    .map((d) => ({ uid: d.id, ...(d.data() as { role?: string; status?: string }) }))
    .filter((m) => (m.status ?? "active") === "active");
  return (
    active.find((m) => m.role === "owner")?.uid ??
    active.find((m) => m.role === "admin")?.uid ??
    ""
  );
}

export async function ingestWebsiteLeadServer(
  payload: WebsiteLeadPayload,
): Promise<WebsiteLeadIngestResult> {
  const organizationId = payload.organizationId;
  const email = payload.contactEmail?.trim().toLowerCase() ?? "";
  const name = payload.contactName?.trim() ?? "";
  const company = payload.companyName?.trim() || (email ? companyFromEmail(email) : "");
  if (!email && !name && !company) {
    return { ok: false, error: "Provide at least contactEmail, contactName or companyName." };
  }

  if (email) {
    const existing = await findLeadIdByContactEmailPostgres(organizationId, email);
    if (existing) return { ok: true, leadId: existing, duplicate: true };
  }

  const ownerId = await resolveIntakeOwnerUid(organizationId);
  if (!ownerId) return { ok: false, error: "Workspace has no active owner to receive leads." };

  const key = email
    ? createHash("sha256").update(`${organizationId}:${email}`).digest("hex").slice(0, 20)
    : randomUUID().replace(/-/g, "").slice(0, 20);
  const ids = { accountId: `web-a-${key}`, contactId: `web-c-${key}`, leadId: `web-l-${key}` };
  const now = new Date().toISOString();
  const source = payload.source?.trim() || "Website form";

  const form = emptyProspectForm();
  const { firstName, lastName } = splitName(name);
  const { account, contact, lead } = buildProspectEntities({
    form: {
      ...form,
      bizName: company || name || email,
      firstName,
      lastName,
      email,
      contactSource: source,
      leadNotes: rawMessage(payload.raw),
    },
    ...ids,
    ownerId,
    now,
  });

  const result = await upsertLeadGraphPostgres(organizationId, {
    account: { id: account.id, doc: { ...account } },
    contact: { id: contact.id, doc: { ...contact } },
    lead: { id: lead.id, doc: { ...lead } },
  });
  if (!result.ok) return { ok: false, error: result.error };

  const db = getAdminDb();
  if (db) {
    try {
      await db.collection(COLLECTIONS.timelineEvents).add({
        organizationId,
        leadId: lead.id,
        leadOwnerId: ownerId,
        leadOwnerManagerIds: await resolveOwnerManagerIdsAdmin(db, ownerId),
        type: "lead_created",
        actorId: ownerId,
        summary: `Prospect created from ${source}.`,
        payload: { source, webhook: true },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("[website-lead] timeline write failed", lead.id, err);
    }
  }
  return { ok: true, leadId: lead.id, duplicate: false };
}
