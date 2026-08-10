import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  aggregateReplyIntelligence,
  filterReplyActionsVisibleToViewer,
  filterReplyAnalyticsRows,
  parseReplyAnalyticsRange,
  toReplyActionDrillRow,
  type ReplyLeadOutcome,
} from "@/lib/email/reply-action-analytics";
import { listReplyActionsForAnalyticsServer } from "@/lib/email/list-reply-actions-analytics-server";
import {
  getCachedReplyIntelList,
  replyIntelListCacheKey,
  setCachedReplyIntelList,
} from "@/lib/email/reply-intel-cache";
import { listMembersForDisplayServer } from "@/lib/platform/member-display";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { seesAllLeadsInTenant } from "@/lib/workspace-hierarchy";
import type { User } from "@/lib/types";

const OUTCOMES = new Set<ReplyLeadOutcome>(["won", "lost", "open", "unknown"]);

function resolveViewer(input: {
  uid: string;
  orgRole: User["orgRole"];
  orgUsers: readonly User[];
}): User {
  const fromRoster = input.orgUsers.find((u) => u.id === input.uid);
  if (fromRoster) {
    return {
      ...fromRoster,
      orgRole: fromRoster.orgRole ?? input.orgRole,
    };
  }
  return {
    id: input.uid,
    email: "",
    displayName: "",
    roleId: "salesperson",
    orgRole: input.orgRole,
    status: "active",
    createdAt: "",
  };
}

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const range = url.searchParams.get("range");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const classification = url.searchParams.get("classification") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const includeRows = url.searchParams.get("includeRows") === "1";
  const recommendedAction = url.searchParams.get("recommendedAction") ?? undefined;
  const draftStatus = url.searchParams.get("draftStatus") ?? undefined;
  const ownerId = url.searchParams.get("ownerId") ?? undefined;
  const day = url.searchParams.get("day") ?? undefined;
  const outcomeRaw = url.searchParams.get("outcome");
  const outcome =
    outcomeRaw && OUTCOMES.has(outcomeRaw as ReplyLeadOutcome)
      ? (outcomeRaw as ReplyLeadOutcome)
      : undefined;
  const decidedOnly = url.searchParams.get("decidedOnly") === "1";
  const winRateCohort = url.searchParams.get("winRateCohort") === "1";

  const { fromIso, toIso, key: rangeKey } = parseReplyAnalyticsRange(range, from, to);
  const orgId = g.ctx.session.organizationId;
  const viewerUid = g.ctx.session.uid;

  const listKey = replyIntelListCacheKey({
    organizationId: orgId,
    fromIso,
    toIso,
    classification,
    status,
  });

  const [cachedList, orgUsers, members] = await Promise.all([
    getCachedReplyIntelList(listKey),
    listOrgUsersServer(orgId),
    listMembersForDisplayServer(orgId),
  ]);

  let listed;
  let listCached = false;
  if (cachedList) {
    listed = cachedList.rows;
    listCached = true;
  } else {
    listed = await listReplyActionsForAnalyticsServer({
      organizationId: orgId,
      fromIso,
      toIso,
      classification,
      status,
    });
    await setCachedReplyIntelList(listKey, listed);
  }

  const viewer = resolveViewer({
    uid: viewerUid,
    orgRole: g.ctx.role,
    orgUsers,
  });
  const orgWide = seesAllLeadsInTenant(viewer);
  const rows = filterReplyActionsVisibleToViewer(listed, viewer, orgUsers);

  const analytics = aggregateReplyIntelligence(rows);
  const memberLabels = Object.fromEntries(members.map((m) => [m.uid, m.label]));

  const payload: Record<string, unknown> = {
    ok: true,
    range: rangeKey,
    fromIso,
    toIso,
    rowCount: rows.length,
    scope: orgWide ? "org" : "mine",
    analytics,
    memberLabels,
    cached: listCached,
  };

  if (includeRows) {
    const refined = filterReplyAnalyticsRows(rows, {
      recommendedAction,
      draftStatus,
      ownerId,
      day,
      outcome,
      decidedOnly,
      winRateCohort,
    });
    payload.rows = refined.map(toReplyActionDrillRow);
    payload.drillCount = refined.length;
  }

  return NextResponse.json(payload);
}
