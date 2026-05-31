import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { listAuditLogsServer } from "@/lib/firestore/audit";
import {
  AUDIT_EVENT_CATEGORY,
  categoryForAuditEvent,
  type AuditEventCategory,
} from "@/lib/firestore/audit-events";
import { listMembersServer } from "@/lib/platform/members-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";

const CATEGORIES = new Set<string>([
  "team",
  "crm",
  "ai",
  "integrations",
  "settings",
  "usage",
]);

export async function GET(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const actorUid = url.searchParams.get("actorUid") ?? undefined;
  const event = url.searchParams.get("event") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;

  const orgId = g.ctx.session.organizationId;
  let { items, nextCursor } = await listAuditLogsServer({
    organizationId: orgId,
    limit: Number.isFinite(limit) ? limit : 50,
    cursor,
    actorUid: actorUid || undefined,
    eventPrefix:
      event && !event.includes("*") ? undefined : event?.replace(/\*$/, ""),
  });

  if (event && !event.endsWith("*")) {
    items = items.filter((row) => row.event === event);
  } else if (event?.endsWith("*")) {
    const prefix = event.slice(0, -1);
    items = items.filter((row) => row.event.startsWith(prefix));
  }

  if (category && CATEGORIES.has(category)) {
    const cat = category as AuditEventCategory;
    items = items.filter((row) => categoryForAuditEvent(row.event) === cat);
  }

  const members = await listMembersServer(orgId);
  const memberByUid = new Map<
    string,
    {
      displayName: string;
      email: string | null;
      role?: import("@/lib/types").OrgMemberRole;
    }
  >(
    members.map((m) => [
      m.uid,
      {
        displayName: m.displayName ?? m.email ?? m.uid,
        email: m.email ?? null,
        role: m.role,
      },
    ]),
  );

  const db = getAdminDb();
  const missingUids = [
    ...new Set(
      items
        .map((i) => i.actorUid)
        .filter((uid) => uid && !memberByUid.has(uid)),
    ),
  ];
  if (db && missingUids.length > 0) {
    const snaps = await Promise.all(
      missingUids.map((uid) => db.collection(COLLECTIONS.users).doc(uid).get()),
    );
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const d = snap.data();
      memberByUid.set(snap.id, {
        displayName: String(d?.name ?? d?.email ?? snap.id),
        email: (d?.email as string) ?? null,
        role: undefined,
      });
    }
  }

  const enriched = items.map((row) => {
    const actor = memberByUid.get(row.actorUid);
    return {
      ...row,
      actorDisplayName: actor?.displayName ?? (row.actorUid || "System"),
      actorEmail: actor?.email ?? null,
      actorOrgRole: actor?.role ?? null,
      category: categoryForAuditEvent(row.event),
    };
  });

  return NextResponse.json({
    items: enriched,
    nextCursor,
    categories: [...CATEGORIES],
  });
}
