import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import {
  buildDashboardAiContext,
  buildDashboardFilterHash,
  buildDashboardWatchCandidates,
  pickDashboardWatchListFromCandidates,
} from "@/lib/ai/context/dashboard-context";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { getOrganizationAiSettingsServer, canUseAiFeature } from "@/lib/ai/ai-settings-server";
import { fetchTenantWorkspaceBundleServer } from "@/lib/ai/server-workspace-fetch";
import {
  OWNER_SCOPE_PREFIX,
  filterLeadsByOwnerScope,
  filterFollowupsByOwnerScope,
  filterLeadTasksByOwnerScope,
  filterActivityCountersByOwnerScope,
  filterActivityRecordsByOwnerScope,
  getOwnerFilterTriggerLabel,
  buildPersonOwnerOptions,
} from "@/lib/owner-scope";
import {
  filterLeadsByDateRange,
  filterDealsByDateRange,
  filterActivityRecordsByDateRange,
  filterActivityCountersByDateRange,
  type DashboardTimeRangeKey,
} from "@/lib/dashboard-date-range";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ChannelKey, Lead, Deal, Followup, LeadTask, User } from "@/lib/types";
import { getMemberServer } from "@/lib/platform/members-server";
import {
  getCachedDashboardBriefServer,
  saveDashboardBriefServer,
} from "@/lib/ai/dashboard-brief-store";
import { recordAudit } from "@/lib/firestore/audit";

const briefSchema = z.object({
  progress: z.string(),
  risks: z.array(z.string()),
  suggestions: z.array(z.string()),
  watchList: z.array(
    z.object({
      title: z.string(),
      reason: z.string(),
      // OpenAI structured output requires every property in `required`; use null when no link.
      href: z.string().nullable(),
    }),
  ),
});

const bodySchema = z.object({
  channelScope: z.array(z.string()).default([]),
  ownerScope: z.string().default("all-owners"),
  timeRange: z.enum(["7d", "30d", "90d", "qtd", "ytd"]).default("30d"),
  regenerate: z.boolean().optional(),
  demoBundle: z
    .object({
      leads: z.array(z.record(z.string(), z.unknown())),
      deals: z.array(z.record(z.string(), z.unknown())),
      followups: z.array(z.record(z.string(), z.unknown())),
      leadTasks: z.array(z.record(z.string(), z.unknown())),
      users: z.array(z.record(z.string(), z.unknown())),
    })
    .optional(),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  const member = await getMemberServer(orgId, uid);
  const userDoc = await getAdminDb()
    ?.collection(COLLECTIONS.users)
    .doc(uid)
    .get();
  const roleId = (userDoc?.data()?.roleId ?? "salesperson") as import("@/lib/types").Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "dashboard_brief", roleId)) {
    return NextResponse.json({ error: "AI dashboard brief is not enabled for your role." }, { status: 403 });
  }

  const channelScope = parsed.data.channelScope as ChannelKey[];
  const timeRange = parsed.data.timeRange as DashboardTimeRangeKey;
  const filterHash = buildDashboardFilterHash({
    channelScope,
    ownerScope: parsed.data.ownerScope,
    timeRange,
  });

  if (!parsed.data.regenerate) {
    const cached = await getCachedDashboardBriefServer(orgId, filterHash);
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  let bundle = parsed.data.demoBundle
    ? {
        leads: parsed.data.demoBundle.leads as unknown as Lead[],
        deals: parsed.data.demoBundle.deals as unknown as Deal[],
        followups: parsed.data.demoBundle.followups as unknown as Followup[],
        leadTasks: parsed.data.demoBundle.leadTasks as unknown as LeadTask[],
        users: parsed.data.demoBundle.users as unknown as User[],
        activityCounters: [],
        activityRecords: [],
      }
    : await fetchTenantWorkspaceBundleServer(orgId);

  if (!bundle) {
    return NextResponse.json({ error: "Could not load workspace data" }, { status: 503 });
  }

  const getUserById = (id: string) => bundle!.users.find((u) => u.id === id);
  const getOwnerDisplayName = (id: string) => getUserById(id)?.displayName ?? id;
  const ownerScopeDeps = {
    currentUserId: uid,
    users: bundle.users,
    getUserById,
    getOwnerDisplayName,
  };

  let leads = bundle.leads;
  if (channelScope.length) leads = leads.filter((l) => channelScope.includes(l.channel));
  leads = filterLeadsByOwnerScope(leads, parsed.data.ownerScope, ownerScopeDeps);
  leads = filterLeadsByDateRange(leads, timeRange);

  const leadIds = new Set(leads.map((l) => l.id));
  let deals = bundle.deals.filter((d) => leadIds.has(d.leadId));
  deals = filterDealsByDateRange(deals, timeRange);

  let activityCounters = bundle.activityCounters;
  if (channelScope.length) {
    activityCounters = activityCounters.filter((r) => channelScope.includes(r.channel));
  }
  activityCounters = filterActivityCountersByOwnerScope(
    filterActivityCountersByDateRange(activityCounters, timeRange),
    parsed.data.ownerScope,
    ownerScopeDeps,
  );

  let activityRecords = bundle.activityRecords;
  if (channelScope.length) {
    activityRecords = activityRecords.filter((r) => channelScope.includes(r.channel));
  }
  activityRecords = filterActivityRecordsByOwnerScope(
    filterActivityRecordsByDateRange(activityRecords, timeRange),
    parsed.data.ownerScope,
    ownerScopeDeps,
  );

  const personOwnerOptions = buildPersonOwnerOptions(
    bundle.leads,
    bundle.users,
    getUserById,
    getOwnerDisplayName,
  );
  const ownerLabel = getOwnerFilterTriggerLabel(parsed.data.ownerScope, personOwnerOptions);

  let followups = filterFollowupsByOwnerScope(bundle.followups, parsed.data.ownerScope, ownerScopeDeps);
  let leadTasks = filterLeadTasksByOwnerScope(bundle.leadTasks, parsed.data.ownerScope, ownerScopeDeps);

  // Single-person analysis: only items on that person's scoped leads (drops orphan / cross-owner noise).
  if (parsed.data.ownerScope.startsWith(OWNER_SCOPE_PREFIX)) {
    followups = followups.filter((f) => f.leadId != null && leadIds.has(f.leadId));
    leadTasks = leadTasks.filter((t) => t.leadId != null && leadIds.has(t.leadId));
  } else {
    followups = followups.filter((f) => !f.leadId || leadIds.has(f.leadId));
    leadTasks = leadTasks.filter((t) => !t.leadId || leadIds.has(t.leadId));
  }

  const watchCandidates = buildDashboardWatchCandidates({ leads, followups, leadTasks });

  const context = buildDashboardAiContext({
    leads,
    deals,
    followups,
    leadTasks,
    users: bundle.users,
    channelScope,
    ownerLabel,
    timeRange,
  });

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: member?.displayName ?? g.ctx.session.name,
      roleId,
      feature: "dashboard_brief",
      promptVars: {
        filters: `${ownerLabel} · ${timeRange}${channelScope.length ? ` · ${channelScope.length} channels` : ""}`,
        context,
      },
      schema: briefSchema,
      filterHash,
    });

    const watchList = pickDashboardWatchListFromCandidates(watchCandidates, 5);
    const payload = await saveDashboardBriefServer({
      organizationId: orgId,
      userId: uid,
      filters: {
        filterHash,
        channelScope,
        ownerScope: parsed.data.ownerScope,
        timeRange,
        ownerLabel,
      },
      result: { ...result, watchList },
    });

    void recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "feature.dashboard_brief",
      meta: {
        ownerScope: parsed.data.ownerScope,
        timeRange,
        filterHash,
      },
    });

    return NextResponse.json(payload);
  } catch (e) {
    return aiErrorResponse(e);
  }
}
