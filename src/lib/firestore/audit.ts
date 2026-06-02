import { FieldValue } from "firebase-admin/firestore";
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
  | "scraper.raw_promote";

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
  const col = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.audit);

  let q = input.actorUid
    ? col.where("actorUid", "==", input.actorUid).orderBy("createdAt", "desc").limit(limit)
    : col.orderBy("createdAt", "desc").limit(limit);
  if (input.cursor) {
    const cursorSnap = await col.doc(input.cursor).get();
    if (cursorSnap.exists) {
      q = input.actorUid
        ? col
            .where("actorUid", "==", input.actorUid)
            .orderBy("createdAt", "desc")
            .startAfter(cursorSnap)
            .limit(limit)
        : col.orderBy("createdAt", "desc").startAfter(cursorSnap).limit(limit);
    }
  }

  const snap = await q.get();
  let items: AuditLogRecord[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      organizationId: String(data.organizationId ?? input.organizationId),
      actorUid: String(data.actorUid ?? ""),
      event: data.event as AuditEvent,
      meta: (data.meta as Record<string, unknown>) ?? {},
      createdAt: timestampToIso(data.createdAt),
    };
  });

  if (input.eventPrefix) {
    const prefix = input.eventPrefix;
    items = items.filter((row) => row.event.startsWith(prefix));
  }

  const last = snap.docs[snap.docs.length - 1];
  const nextCursor =
    snap.docs.length >= limit && last ? last.id : null;

  return { items, nextCursor };
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
}): Promise<{ items: AuditLogRecord[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const needsPostFilter = !!(
    input.category ||
    (input.event && !input.event.includes("*")) ||
    input.event?.endsWith("*")
  );

  if (!needsPostFilter) {
    return listAuditLogsServer({
      organizationId: input.organizationId,
      limit,
      cursor: input.cursor,
      actorUid: input.actorUid,
      eventPrefix: input.eventPrefix,
    });
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
      return { items: accumulated, nextCursor };
    }

    if (!dbHasMore) break;
  }

  return { items: accumulated, nextCursor: null };
}
