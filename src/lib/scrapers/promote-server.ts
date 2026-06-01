import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate } from "@/lib/firestore/tenant-write";
import type { Account, ChannelKey, Contact, Lead, ScraperRawItem } from "@/lib/types";
import { getScraperRawItemServer, markRawItemPromotedServer } from "@/lib/scrapers/raw-items-server";

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function contactNameFromRaw(item: ScraperRawItem): { firstName: string; lastName: string; fullName: string } {
  const raw =
    item.creator?.trim() ||
    item.dcCreator?.trim() ||
    item.title.split(/[-–|:]/)[0]?.trim() ||
    "Unknown";
  const cleaned = stripHtml(raw).slice(0, 120) || "Unknown contact";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "Unknown";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
  const fullName = firstName === lastName ? firstName : `${firstName} ${lastName}`;
  return { firstName, lastName, fullName };
}

function channelForPlatform(platform: ScraperRawItem["platform"]): ChannelKey {
  if (platform === "linkedin") return "linkedin_outbound";
  return "website_form";
}

function buildNotes(item: ScraperRawItem): string {
  const snippet = item.contentSnippet?.trim() || stripHtml(item.content).slice(0, 500);
  const lines = [
    `Source: ${item.feedName} (${item.platform} · ${item.category})`,
    `Link: ${item.link}`,
    snippet ? `\n${snippet}` : "",
  ];
  return lines.join("\n").trim();
}

export async function promoteRawItemToProspectServer(input: {
  organizationId: string;
  itemId: string;
  userId: string;
  /** Empty string = open queue. */
  ownerId: string;
  scraperId?: string;
}): Promise<
  | { ok: true; leadId: string; accountId: string; contactId: string }
  | { error: string }
> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const item = await getScraperRawItemServer(input.organizationId, input.itemId);
  if (!item) return { error: "Item not found" };
  if (item.status === "promoted" && item.promotedToLeadId) {
    return {
      ok: true,
      leadId: item.promotedToLeadId,
      accountId: "",
      contactId: "",
    };
  }
  if (item.status === "dismissed") return { error: "Item was dismissed" };

  const now = new Date().toISOString();
  const { firstName, lastName, fullName } = contactNameFromRaw(item);
  const companyName = item.title.trim().slice(0, 200) || "Unknown company";
  const accountId = newEntityId("a");
  const contactId = newEntityId("ct");
  const leadId = newEntityId("l");
  const ownerId = input.ownerId.trim();
  const notes = buildNotes(item);

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

  const lead: Lead = {
    id: leadId,
    accountId,
    contactId,
    channel: channelForPlatform(item.platform),
    stage: "new",
    temperature: "cold",
    priority: item.category === "problem" ? "high" : "medium",
    ownerId,
    createdById: input.userId,
    scraperId: input.scraperId?.trim() || item.feedId || input.userId,
    intakeKind: "prospect",
    contactName: fullName,
    companyName,
    touches: 0,
    isIdle: false,
    notes,
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

  const batch = db.batch();
  const aRef = db.collection(COLLECTIONS.accounts).doc(accountId);
  const cRef = db.collection(COLLECTIONS.contacts).doc(contactId);
  const lRef = db.collection(COLLECTIONS.leads).doc(leadId);

  batch.set(
    aRef,
    stampForCreate(input.organizationId, account as unknown as Record<string, unknown>, input.userId),
  );
  batch.set(
    cRef,
    stampForCreate(input.organizationId, contact as unknown as Record<string, unknown>, input.userId),
  );
  batch.set(
    lRef,
    stampForCreate(input.organizationId, lead as unknown as Record<string, unknown>, input.userId),
  );
  await batch.commit();

  const marked = await markRawItemPromotedServer({
    organizationId: input.organizationId,
    itemId: input.itemId,
    userId: input.userId,
    leadId,
  });
  if ("error" in marked) return { error: marked.error };

  return { ok: true, leadId, accountId, contactId };
}
