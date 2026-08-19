import { NextResponse } from "next/server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { listAuditRecordsInRangeServer } from "@/lib/documents/audit";
import {
  aggregateAuditAnalytics,
  parseAuditAnalyticsRange,
} from "@/lib/audit-analytics";
import { listMembersForDisplayServer } from "@/lib/platform/member-display";

export async function GET(req: Request) {
  const g = await guardAdminFeature("activity_logs");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const actorUid = url.searchParams.get("actorUid") ?? undefined;
  const channel = url.searchParams.get("channel") ?? undefined;
  const range = url.searchParams.get("range");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const { fromIso, toIso, key: rangeKey } = parseAuditAnalyticsRange(range, from, to);
  const orgId = g.ctx.session.organizationId;

  const rows = await listAuditRecordsInRangeServer({
    organizationId: orgId,
    actorUid: actorUid && actorUid !== "all" ? actorUid : undefined,
    fromIso,
    toIso,
  });

  const analytics = aggregateAuditAnalytics(rows, channel && channel !== "all" ? channel : undefined);
  const filterMembers = await listMembersForDisplayServer(orgId);

  const memberLabels = Object.fromEntries(filterMembers.map((m) => [m.uid, m.label]));

  return NextResponse.json({
    range: rangeKey,
    fromIso,
    toIso,
    analytics,
    memberLabels,
  });
}
