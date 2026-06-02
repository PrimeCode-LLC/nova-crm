import {
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import {
  categoryForAuditEvent,
  type AuditEventCategory,
} from "@/lib/firestore/audit-events";

export type AuditEvent =
  | "member.invited"
  | "member.provisioned"
  | "member.joined"
  | "member.approved"
  | "member.role_changed"
  | "member.disabled"
  | "member.enabled"
  | "member.removed"
  | "org.open_join_link_rotated"
  | "org.open_join_link_cleared"
  | "invite.revoked"
  | "lead.created"
  | "lead.stage_changed"
  | "deal.created"
  | "deal.won"
  | "deal.lost"
  | "settings.updated"
  | "channel_admin.updated"
  | "user.hierarchy_updated"
  | "user.feature_grants_updated"
  | "ai.settings_updated"
  | "ai.key_rotated"
  | "ai.library_indexed"
  | "instantly.connected"
  | "instantly.disconnected"
  | "instantly.campaign_created"
  | "instantly.campaigns_synced"
  | "instantly.campaign_leads_synced"
  | "instantly.leads_pushed"
  | "instantly.webhook_reply"
  | "feature.page_view"
  | "feature.fit_check"
  | "feature.lead_analyze"
  | "feature.followup_suggest"
  | "feature.dashboard_brief"
  | "feature.outreach_view"
  | "feature.import"
  | "scraper.feeds_seed"
  | "scraper.run"
  | "scraper.feed_create"
  | "scraper.feed_delete"
  | "scraper.raw_promote"
  | "intake_filter_defaults.updated";

export type AuditLogRecord = {
  id: string;
  organizationId: string;
  actorUid: string;
  event: AuditEvent;
  meta: Record<string, unknown>;
  createdAt: string | null;
};

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * Append-only per-tenant audit log. Always-on side-channel — failures
 * are swallowed because audit must never break a primary write.
 */
export async function recordAudit(input: {
  organizationId: string;
  actorUid: string;
  event: AuditEvent;
  /** Free-form payload (must be JSON-serialisable). */
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getAdminDb();
    if (!db) return;
    await db
      .collection(COLLECTIONS.organizations)
      .doc(input.organizationId)
      .collection(ORG_SUBCOLLECTIONS.audit)
      .add({
        organizationId: input.organizationId,
        actorUid: input.actorUid,
        event: input.event,
        meta: input.meta ?? {},
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (e) {
    // Surface in logs but never throw.
    console.error("[audit]", input.event, e);
  }
}

const IN_MEMORY_AUDIT_CAP = 2_000;

function docToAuditRecord(
  doc: QueryDocumentSnapshot,
  organizationId: string,
): AuditLogRecord {
  const data = doc.data();
  return {
    id: doc.id,
    organizationId: String(data.organizationId ?? organizationId),
    actorUid: String(data.actorUid ?? ""),
    event: data.event as AuditEvent,
    meta: (data.meta as Record<string, unknown>) ?? {},
    createdAt: timestampToIso(data.createdAt),
  };
}

function sortAuditRecords(items: AuditLogRecord[]): AuditLogRecord[] {
  return [...items].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return b.id.localeCompare(a.id);
  });
}

function auditCol(db: Firestore, organizationId: string) {
  return db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.audit);
}

export async function countAuditLogsServer(input: {
  organizationId: string;
  actorUid?: string;
}): Promise<number> {
  const db = getAdminDb();
  if (!db) return 0;
  const col = auditCol(db, input.organizationId);
  const q = input.actorUid
    ? col.where("actorUid", "==", input.actorUid)
    : col;
  const snap = await q.count().get();
  return snap.data().count;
}

async function listAllAuditRecordsServer(input: {
  organizationId: string;
  actorUid?: string;
}): Promise<AuditLogRecord[]> {
  const db = getAdminDb();
  if (!db) return [];
  const col = auditCol(db, input.organizationId);
  const snap = input.actorUid
    ? await col.where("actorUid", "==", input.actorUid).get()
    : await col.get();
  return sortAuditRecords(
    snap.docs.map((doc) => docToAuditRecord(doc, input.organizationId)),
  );
}

function paginateSortedAuditRecords(
  sorted: AuditLogRecord[],
  limit: number,
  cursor?: string,
): { items: AuditLogRecord[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const idx = sorted.findIndex((row) => row.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const slice = sorted.slice(start, start + limit + 1);
  const hasMore = slice.length > limit;
  const items = hasMore ? slice.slice(0, limit) : slice;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;
  return { items, nextCursor };
}

export async function listAuditLogsServer(input: {
  organizationId: string;
  limit?: number;
  cursor?: string;
  actorUid?: string;
  eventPrefix?: string;
}): Promise<{ items: AuditLogRecord[]; nextCursor: string | null }> {
  const db = getAdminDb();
  if (!db) return { items: [], nextCursor: null };

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const total = await countAuditLogsServer({
    organizationId: input.organizationId,
    actorUid: input.actorUid,
  });

  if (total <= IN_MEMORY_AUDIT_CAP) {
    let sorted = await listAllAuditRecordsServer({
      organizationId: input.organizationId,
      actorUid: input.actorUid,
    });
    if (input.eventPrefix) {
      const prefix = input.eventPrefix;
      sorted = sorted.filter((row) => row.event.startsWith(prefix));
    }
    return paginateSortedAuditRecords(sorted, limit, input.cursor);
  }

  const col = auditCol(db, input.organizationId);
  const fetchLimit = limit + 1;

  let q = input.actorUid
    ? col
        .where("actorUid", "==", input.actorUid)
        .orderBy("createdAt", "desc")
        .limit(fetchLimit)
    : col.orderBy("createdAt", "desc").limit(fetchLimit);
  if (input.cursor) {
    const cursorSnap = await col.doc(input.cursor).get();
    if (cursorSnap.exists) {
      q = input.actorUid
        ? col
            .where("actorUid", "==", input.actorUid)
            .orderBy("createdAt", "desc")
            .startAfter(cursorSnap)
            .limit(fetchLimit)
        : col.orderBy("createdAt", "desc").startAfter(cursorSnap).limit(fetchLimit);
    }
  }

  const snap = await q.get();
  let items: AuditLogRecord[] = snap.docs.map((doc) =>
    docToAuditRecord(doc, input.organizationId),
  );

  if (input.eventPrefix) {
    const prefix = input.eventPrefix;
    items = items.filter((row) => row.event.startsWith(prefix));
  }

  const hasMore = snap.docs.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;
  const nextCursor =
    hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1]!.id : null;

  return { items: pageItems, nextCursor };
}

function applyAuditPostFilters(
  items: AuditLogRecord[],
  filters: {
    category?: AuditEventCategory;
    event?: string;
  },
): AuditLogRecord[] {
  let filtered = items;
  if (filters.event && !filters.event.endsWith("*")) {
    filtered = filtered.filter((row) => row.event === filters.event);
  } else if (filters.event?.endsWith("*")) {
    const prefix = filters.event.slice(0, -1);
    filtered = filtered.filter((row) => row.event.startsWith(prefix));
  }
  if (filters.category) {
    filtered = filtered.filter(
      (row) => categoryForAuditEvent(row.event) === filters.category,
    );
  }
  return filtered;
}

/**
 * Paginated audit list with correct cursors when category/event filters
 * are applied in memory (Firestore cannot filter by derived category).
 */
export async function listAuditLogsFilteredServer(input: {
  organizationId: string;
  limit?: number;
  cursor?: string;
  actorUid?: string;
  eventPrefix?: string;
  category?: AuditEventCategory;
  event?: string;
}): Promise<{ items: AuditLogRecord[]; nextCursor: string | null; totalCount: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const needsPostFilter = !!(
    input.category ||
    (input.event && !input.event.includes("*")) ||
    input.event?.endsWith("*")
  );

  const rawTotal = await countAuditLogsServer({
    organizationId: input.organizationId,
    actorUid: input.actorUid,
  });

  if (!needsPostFilter) {
    const page = await listAuditLogsServer({
      organizationId: input.organizationId,
      limit,
      cursor: input.cursor,
      actorUid: input.actorUid,
      eventPrefix: input.eventPrefix,
    });
    return { ...page, totalCount: rawTotal };
  }

  if (rawTotal <= IN_MEMORY_AUDIT_CAP) {
    let sorted = await listAllAuditRecordsServer({
      organizationId: input.organizationId,
      actorUid: input.actorUid,
    });
    if (input.eventPrefix) {
      const prefix = input.eventPrefix;
      sorted = sorted.filter((row) => row.event.startsWith(prefix));
    }
    sorted = applyAuditPostFilters(sorted, {
      category: input.category,
      event: input.event,
    });
    const page = paginateSortedAuditRecords(sorted, limit, input.cursor);
    return { ...page, totalCount: sorted.length };
  }

  const accumulated: AuditLogRecord[] = [];
  let cursor = input.cursor;
  let dbHasMore = true;
  const maxPasses = 20;

  for (let pass = 0; pass < maxPasses && accumulated.length < limit && dbHasMore; pass++) {
    const batch = await listAuditLogsServer({
      organizationId: input.organizationId,
      limit: 100,
      cursor,
      actorUid: input.actorUid,
      eventPrefix: input.eventPrefix,
    });

    if (batch.items.length === 0) {
      dbHasMore = false;
      break;
    }

    const filtered = applyAuditPostFilters(batch.items, {
      category: input.category,
      event: input.event,
    });

    for (const item of filtered) {
      if (accumulated.length >= limit) break;
      accumulated.push(item);
    }

    dbHasMore = !!batch.nextCursor;
    cursor = batch.nextCursor ?? undefined;

    if (accumulated.length >= limit) {
      const lastReturned = accumulated[accumulated.length - 1]!;
      const lastIdx = filtered.findIndex((row) => row.id === lastReturned.id);
      const moreInBatch = lastIdx >= 0 && lastIdx < filtered.length - 1;
      const nextCursor = dbHasMore || moreInBatch ? lastReturned.id : null;
      return { items: accumulated, nextCursor, totalCount: rawTotal };
    }

    if (!dbHasMore) break;
  }

  return { items: accumulated, nextCursor: null, totalCount: rawTotal };
}
