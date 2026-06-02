import { NextResponse } from "next/server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { listAuditLogsFilteredServer } from "@/lib/firestore/audit";
import {
  categoryForAuditEvent,
  type AuditEventCategory,
} from "@/lib/firestore/audit-events";
import { listMembersServer } from "@/lib/platform/members-server";
import { listMembersForDisplayServer, memberDisplayLabel } from "@/lib/platform/member-display";
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
  const g = await guardAdminFeature("activity_logs");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const actorUid = url.searchParams.get("actorUid") ?? undefined;
  const event = url.searchParams.get("event") ?? undefined;
  const categoryParam = url.searchParams.get("category") ?? undefined;
  const category =
    categoryParam && CATEGORIES.has(categoryParam)
      ? (categoryParam as AuditEventCategory)
      : undefined;

  const orgId = g.ctx.session.organizationId;
  const { items, nextCursor, totalCount } = await listAuditLogsFilteredServer({
    organizationId: orgId,
    limit: Number.isFinite(limit) ? limit : 50,
    cursor,
    actorUid: actorUid || undefined,
    eventPrefix:
      event && !event.includes("*") ? undefined : event?.replace(/\*$/, ""),
    category,
    event: event || undefined,
  });

  const [members, filterMembers] = await Promise.all([
    listMembersServer(orgId),
    listMembersForDisplayServer(orgId),
  ]);

  const labelByUid = new Map(filterMembers.map((m) => [m.uid, m.label]));
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
        displayName: labelByUid.get(m.uid) ?? memberDisplayLabel(m),
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
        displayName: memberDisplayLabel(
          { uid: snap.id, displayName: "", email: "" },
          d,
        ),
        email: (d?.email as string) ?? null,
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
    totalCount,
    hasMore: !!nextCursor,
    categories: [...CATEGORIES],
    filterMembers,
  });
}
