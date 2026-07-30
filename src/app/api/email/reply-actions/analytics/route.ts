import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  aggregateReplyIntelligence,
  parseReplyAnalyticsRange,
} from "@/lib/email/reply-action-analytics";
import { listReplyActionsForAnalyticsServer } from "@/lib/email/list-reply-actions-analytics-server";
import { listMembersForDisplayServer } from "@/lib/platform/member-display";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const range = url.searchParams.get("range");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const classification = url.searchParams.get("classification") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  const { fromIso, toIso, key: rangeKey } = parseReplyAnalyticsRange(range, from, to);
  const orgId = g.ctx.session.organizationId;

  const rows = await listReplyActionsForAnalyticsServer({
    organizationId: orgId,
    fromIso,
    toIso,
    classification,
    status,
  });

  const analytics = aggregateReplyIntelligence(rows);
  const members = await listMembersForDisplayServer(orgId);
  const memberLabels = Object.fromEntries(members.map((m) => [m.uid, m.label]));

  return NextResponse.json({
    ok: true,
    range: rangeKey,
    fromIso,
    toIso,
    rowCount: rows.length,
    analytics,
    memberLabels,
  });
}
