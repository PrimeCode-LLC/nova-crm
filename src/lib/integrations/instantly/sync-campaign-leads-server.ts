import crypto from "crypto";
import type { DocumentReference } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import { listAllLeadsForInstantlyCampaign } from "./client";
import { mapInstantlyLeadToContact } from "./lead-mapper";
import { getInstantlyApiKeyServer } from "./secrets";
import type { InstantlyLead } from "./types";
import { mirrorCrmEntityAfterWrite } from "@/lib/db/dual-write-crm";

export type SyncInstantlyCampaignLeadsResult = {
  total: number;
  linked: number;
  created: number;
  skipped: number;
};

const EMAIL_IN_CHUNK = 30;
const BATCH_OPS_LIMIT = 450;

async function findNovaLeadIdsByEmail(
  organizationId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const db = getAdminDb();
  if (!db) return new Map();
  const map = new Map<string, string>();
  const unique = [...new Set(emails.map((e) => e.toLowerCase()).filter(Boolean))];

  for (let i = 0; i < unique.length; i += EMAIL_IN_CHUNK) {
    const chunk = unique.slice(i, i + EMAIL_IN_CHUNK);
    if (chunk.length === 0) continue;
    const snap = await db
      .collection(COLLECTIONS.leads)
      .where("organizationId", "==", organizationId)
      .where("contactEmail", "in", chunk)
      .get();
    for (const doc of snap.docs) {
      const email = String(doc.data().contactEmail ?? "")
        .trim()
        .toLowerCase();
      if (email) map.set(email, doc.id);
    }
  }

  return map;
}

type PendingCreate = {
  accountId: string;
  contactId: string;
  leadId: string;
  account: Record<string, unknown>;
  contact: Record<string, unknown>;
  lead: Record<string, unknown>;
};

/** Import Instantly campaign leads into Nova (link by email or create CRM records). */
export async function syncInstantlyCampaignLeadsToNova(
  organizationId: string,
  novaCampaignId: string,
  instantlyCampaignId: string,
  uid?: string,
): Promise<SyncInstantlyCampaignLeadsResult> {
  const apiKey = await getInstantlyApiKeyServer(organizationId);
  if (!apiKey) throw new Error("Instantly is not connected");

  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");

  const remoteLeads = await listAllLeadsForInstantlyCampaign(apiKey, instantlyCampaignId);

  const parsed: { remote: InstantlyLead; fields: NonNullable<ReturnType<typeof mapInstantlyLeadToContact>> }[] =
    [];
  let skipped = 0;

  for (const remote of remoteLeads) {
    const fields = mapInstantlyLeadToContact(remote);
    if (!fields) {
      skipped += 1;
      continue;
    }
    parsed.push({ remote, fields });
  }

  const emails = parsed.map((p) => p.fields.email);
  const existingByEmail = await findNovaLeadIdsByEmail(organizationId, emails);

  let linked = 0;
  let created = 0;

  const updates: { ref: DocumentReference; data: Record<string, unknown> }[] = [];
  const creates: PendingCreate[] = [];
  // Open-queue Instantly imports have blank ownerId → empty manager stamp.
  const ownerManagerIds: string[] = [];

  for (const { fields } of parsed) {
    const existingId = existingByEmail.get(fields.email);
    if (existingId) {
      updates.push({
        ref: db.collection(COLLECTIONS.leads).doc(existingId),
        data: stampForUpdate(
          {
            campaignId: novaCampaignId,
            pushToInstantly: "pushed",
            channel: "cold_email",
            contactName: fields.contactName,
            contactTitle: fields.contactTitle ?? null,
            companyName: fields.companyName,
            companyDomain: fields.companyDomain ?? null,
            contactEmail: fields.email,
          },
          uid,
        ),
      });
      linked += 1;
    } else {
      const accountId = `a-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const contactId = `ct-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const leadId = `l-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      creates.push({
        accountId,
        contactId,
        leadId,
        account: stampForCreate(
          organizationId,
          {
            name: fields.companyName,
            domain: fields.companyDomain ?? null,
            ownerManagerIds,
          },
          uid,
        ),
        contact: stampForCreate(
          organizationId,
          {
            accountId,
            name: fields.contactName,
            email: fields.email,
            title: fields.contactTitle ?? null,
            ownerManagerIds,
          },
          uid,
        ),
        lead: stampForCreate(
          organizationId,
          {
            accountId,
            contactId,
            channel: "cold_email",
            campaignId: novaCampaignId,
            stage: "new",
            temperature: "cold",
            priority: "medium",
            ownerId: "",
            ownerManagerIds,
            contactName: fields.contactName,
            contactTitle: fields.contactTitle ?? null,
            contactEmail: fields.email,
            companyName: fields.companyName,
            companyDomain: fields.companyDomain ?? null,
            pushToInstantly: "pushed",
            touches: 0,
          },
          uid,
        ),
      });
      created += 1;
    }
  }

  for (let i = 0; i < updates.length; i += BATCH_OPS_LIMIT) {
    const slice = updates.slice(i, i + BATCH_OPS_LIMIT);
    const batch = db.batch();
    for (const u of slice) {
      batch.update(u.ref, u.data);
    }
    await batch.commit();
    for (const u of slice) {
      await mirrorCrmEntityAfterWrite("lead", u.ref.id, { organizationId });
    }
  }

  for (let i = 0; i < creates.length; i += Math.floor(BATCH_OPS_LIMIT / 3)) {
    const slice = creates.slice(i, i + Math.floor(BATCH_OPS_LIMIT / 3));
    const batch = db.batch();
    for (const c of slice) {
      batch.set(db.collection(COLLECTIONS.accounts).doc(c.accountId), c.account);
      batch.set(db.collection(COLLECTIONS.contacts).doc(c.contactId), c.contact);
      batch.set(db.collection(COLLECTIONS.leads).doc(c.leadId), c.lead);
    }
    await batch.commit();
    for (const c of slice) {
      await mirrorCrmEntityAfterWrite("account", c.accountId, {
        organizationId,
      });
      await mirrorCrmEntityAfterWrite("contact", c.contactId, {
        organizationId,
      });
      await mirrorCrmEntityAfterWrite("lead", c.leadId, { organizationId });
    }
  }

  return {
    total: remoteLeads.length,
    linked,
    created,
    skipped,
  };
}
