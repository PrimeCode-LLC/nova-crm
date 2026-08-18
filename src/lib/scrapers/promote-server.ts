import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import { stampForCreate } from "@/lib/firestore/tenant-write";
import type { Account, ChannelKey, Contact, Lead, ScraperRawItem } from "@/lib/types";
import {
  companyNameFromRaw,
  contactNameFromRaw,
} from "@/lib/scrapers/raw-item-field-parser";
import { getScraperRawItemServer, markRawItemPromotedServer } from "@/lib/scrapers/raw-items-server";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import { getOrganizationIntentPlaybookServer } from "@/lib/intent/intent-playbook-server";
import { withInitialQualityScore } from "@/lib/intent/apply-quality-score";
import { researchFieldsFromIntakeItem } from "@/lib/intent/score-intake-item";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { mirrorCrmEntityAfterWrite } from "@/lib/db/dual-write-crm";
import {
  getAccountFromPostgres,
  getContactFromPostgres,
  getLeadFromPostgres,
} from "@/lib/db/list-crm-postgres";
import {
  isCrmSoleWriterActive,
  upsertLeadGraphSoleWriter,
} from "@/lib/db/crm-sole-writer-server";
import { resolveOwnerManagerIdsAdmin } from "@/lib/firestore/resolve-owner-manager-ids-admin";

function mapAccountDoc(id: string, raw: Record<string, unknown>): Account {
  const base = { ...raw, id } as unknown as Account;
  return {
    ...base,
    id,
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
  };
}

function mapContactDoc(id: string, raw: Record<string, unknown>): Contact {
  const base = { ...raw, id } as unknown as Contact;
  return {
    ...base,
    id,
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
  };
}

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function channelForPlatform(platform: ScraperRawItem["platform"]): ChannelKey {
  if (platform === "linkedin") return "linkedin_outbound";
  return "website_form";
}

export async function promoteRawItemToProspectServer(input: {
  organizationId: string;
  itemId: string;
  userId: string;
  /** Empty string = open queue. */
  ownerId: string;
  scraperId?: string;
}): Promise<
  | {
      ok: true;
      leadId: string;
      accountId: string;
      contactId: string;
      lead: Lead;
      account: Account;
      contact: Contact;
    }
  | { error: string }
> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const soleWriter = isCrmSoleWriterActive();

  const item = await getScraperRawItemServer(input.organizationId, input.itemId);
  if (!item) return { error: "Item not found" };
  if (item.status === "promoted" && item.promotedToLeadId) {
    if (soleWriter) {
      const lead = await getLeadFromPostgres(
        input.organizationId,
        item.promotedToLeadId,
      );
      if (!lead) return { error: "Promoted lead record is missing" };
      const accountId = lead.accountId;
      const contactId = lead.contactId;
      const [account, contact] = await Promise.all([
        accountId
          ? getAccountFromPostgres(input.organizationId, accountId)
          : Promise.resolve(null),
        contactId
          ? getContactFromPostgres(input.organizationId, contactId)
          : Promise.resolve(null),
      ]);
      const fallbackAt = new Date().toISOString();
      return {
        ok: true,
        leadId: item.promotedToLeadId,
        accountId,
        contactId,
        lead,
        account: account ?? {
          id: accountId || "a-unknown",
          name: "Unknown company",
          contactCount: 0,
          leadCount: 0,
          openDealValue: 0,
          ownerId: lead.ownerId,
          createdAt: fallbackAt,
          updatedAt: fallbackAt,
        },
        contact: contact ?? {
          id: contactId || "ct-unknown",
          accountId: accountId || "a-unknown",
          firstName: "Unknown",
          lastName: "Contact",
          fullName: "Unknown contact",
          ownerId: lead.ownerId,
          createdAt: fallbackAt,
          updatedAt: fallbackAt,
        },
      };
    }
    const existing = await db.collection(COLLECTIONS.leads).doc(item.promotedToLeadId).get();
    if (!existing.exists) {
      return { error: "Promoted lead record is missing" };
    }
    const leadData = existing.data() as Record<string, unknown>;
    const accountId = String(leadData.accountId ?? "");
    const contactId = String(leadData.contactId ?? "");
    const [accountSnap, contactSnap] = await Promise.all([
      accountId ? db.collection(COLLECTIONS.accounts).doc(accountId).get() : null,
      contactId ? db.collection(COLLECTIONS.contacts).doc(contactId).get() : null,
    ]);
    const fallbackAt = new Date().toISOString();
    return {
      ok: true,
      leadId: item.promotedToLeadId,
      accountId,
      contactId,
      lead: mapLeadDoc(item.promotedToLeadId, leadData),
      account: accountSnap?.exists
        ? mapAccountDoc(accountId, accountSnap.data() as Record<string, unknown>)
        : {
            id: accountId || "a-unknown",
            name: "Unknown company",
            contactCount: 0,
            leadCount: 0,
            openDealValue: 0,
            ownerId: String(leadData.ownerId ?? ""),
            createdAt: fallbackAt,
            updatedAt: fallbackAt,
          },
      contact: contactSnap?.exists
        ? mapContactDoc(contactId, contactSnap.data() as Record<string, unknown>)
        : {
            id: contactId || "ct-unknown",
            accountId: accountId || "a-unknown",
            firstName: "Unknown",
            lastName: "Contact",
            fullName: "Unknown contact",
            ownerId: String(leadData.ownerId ?? ""),
            createdAt: fallbackAt,
            updatedAt: fallbackAt,
          },
    };
  }
  if (item.status === "dismissed") return { error: "Item was dismissed" };

  const now = new Date().toISOString();
  const companyName = companyNameFromRaw(item);
  const { firstName, lastName, fullName } = contactNameFromRaw(item, companyName);
  const accountId = newEntityId("a");
  const contactId = newEntityId("ct");
  const leadId = newEntityId("l");
  const ownerId = input.ownerId.trim();
  const research = researchFieldsFromIntakeItem(item);

  const account: Account = {
    id: accountId,
    name: companyName,
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
    fullName,
    ownerId,
    createdAt: now,
    updatedAt: now,
  };

  const leadBase: Lead = {
    id: leadId,
    accountId,
    contactId,
    channel: channelForPlatform(item.platform),
    stage: "new",
    temperature: "cold",
    priority: item.category === "problem" ? "high" : "medium",
    ownerId: input.ownerId.trim() || input.userId,
    createdById: input.userId,
    scraperId: input.scraperId?.trim() || item.feedId || input.userId,
    intakeKind: "prospect",
    prospectOwnerId: input.ownerId.trim() || input.userId,
    prospectVisibility: "open",
    contactName: fullName,
    companyName,
    touches: 0,
    isIdle: false,
    ...research,
    extensions: {
      scraperSource: {
        rawItemId: item.id,
        feedId: item.feedId,
        feedName: item.feedName,
        platform: item.platform,
        category: item.category,
        link: item.link,
        guid: item.guid ?? null,
        publishedAt: item.publishedAt,
      },
    },
    createdAt: now,
    updatedAt: now,
  };

  const playbook = await getOrganizationIntentPlaybookServer(input.organizationId);
  const lead = withInitialQualityScore(leadBase, playbook, []);
  const ownerManagerIds = await resolveOwnerManagerIdsAdmin(db, ownerId || input.userId);

  const accountDoc = stampForCreate(
    input.organizationId,
    stripUndefined({
      ...(account as unknown as Record<string, unknown>),
      ownerManagerIds,
    }),
    input.userId,
  );
  const contactDoc = stampForCreate(
    input.organizationId,
    stripUndefined({
      ...(contact as unknown as Record<string, unknown>),
      ownerManagerIds,
    }),
    input.userId,
  );
  const leadDoc = stampForCreate(
    input.organizationId,
    stripUndefined({
      ...(lead as unknown as Record<string, unknown>),
      ownerManagerIds,
    }),
    input.userId,
  );

  if (soleWriter) {
    await upsertLeadGraphSoleWriter(input.organizationId, {
      account: { id: accountId, doc: accountDoc },
      contact: { id: contactId, doc: contactDoc },
      lead: { id: leadId, doc: leadDoc },
    });
  } else {
    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.accounts).doc(accountId), accountDoc);
    batch.set(db.collection(COLLECTIONS.contacts).doc(contactId), contactDoc);
    batch.set(db.collection(COLLECTIONS.leads).doc(leadId), leadDoc);
    await batch.commit();

    await mirrorCrmEntityAfterWrite("account", accountId, {
      organizationId: input.organizationId,
    });
    await mirrorCrmEntityAfterWrite("contact", contactId, {
      organizationId: input.organizationId,
    });
    await mirrorCrmEntityAfterWrite("lead", leadId, {
      organizationId: input.organizationId,
    });
  }

  const teId = newEntityId("te");
  await db.collection(COLLECTIONS.timelineEvents).doc(teId).set(
    stampForCreate(
      input.organizationId,
      {
        leadId,
        leadOwnerId: ownerId || input.userId,
        leadOwnerManagerIds: ownerManagerIds,
        type: "lead_created",
        actorId: input.userId,
        summary: `Promoted from intake: ${companyName}`,
        payload: { source: "intake", rawItemId: item.id },
        createdAt: now,
      },
      input.userId,
    ),
  );

  const oaId = newEntityId("oa");
  await db.collection(COLLECTIONS.orgActivityEvents).doc(oaId).set(
    stampForCreate(
      input.organizationId,
      {
        type: "intake_promoted",
        actorId: input.userId,
        summary: `Promoted intake item to prospect “${companyName}”`,
        createdAt: now,
        href: `/leads/${leadId}`,
        entityType: "lead",
        entityId: leadId,
        payload: { leadId, rawItemId: item.id },
      },
      input.userId,
    ),
  );

  const marked = await markRawItemPromotedServer({
    organizationId: input.organizationId,
    itemId: input.itemId,
    userId: input.userId,
    leadId,
  });
  if ("error" in marked) return { error: marked.error };

  return { ok: true, leadId, accountId, contactId, lead, account, contact };
}
