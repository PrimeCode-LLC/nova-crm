/**
 * Full org dashboard summary recompute for Cloud Functions (P0.10).
 * Keep in sync with `src/lib/dashboard-summary-compute.ts` (Next cannot be imported here).
 */

import type { Firestore } from "firebase-admin/firestore";
import {
  ORG_DASHBOARD_SUMMARIES,
  ORG_DASHBOARD_SUMMARY_VERSION,
  emptyOrgDashboardSummary,
  leadCountsTowardIdleSalesLeads,
  leadCountsTowardOpenSalesLeads,
} from "./openSalesLeads";
import {
  computeOrgOpenPipelineGauges,
  computePipelineByStage,
  type PipelineDealFields,
  type PipelineLeadFields,
} from "./openPipeline";

const RANGE_KEYS = ["today", "7d", "30d", "all"] as const;

const CHANNEL_FUNNEL_KEYS: Record<string, string[]> = {
  cold_email: ["sent", "opened", "clicked", "replied", "meeting", "closed"],
  linkedin_outbound: ["connection_sent", "accepted", "messaged", "replied", "meeting", "closed"],
  linkedin_1to1: ["messaged", "replied", "meeting", "closed"],
  personalized_email: ["sent", "replied", "meeting", "closed"],
  website_form: ["submitted", "contacted", "meeting", "closed"],
  upwork: ["applied", "viewed", "replied", "hired", "revenue"],
  job_apply: ["applied", "recruiter_reply", "interview", "offer"],
};

const REPLIED_STAGES = new Set([
  "replied",
  "qualified",
  "discovery",
  "proposal",
  "negotiation",
  "won",
]);

function validTime(iso: unknown): number | undefined {
  if (typeof iso !== "string" || !iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function startOfUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function rangeStartMs(key: (typeof RANGE_KEYS)[number], now: Date): number {
  if (key === "all") return 0;
  if (key === "today") return startOfUtcDay(now);
  const d = new Date(now);
  if (key === "7d") d.setUTCDate(d.getUTCDate() - 7);
  else d.setUTCDate(d.getUTCDate() - 30);
  return d.getTime();
}

function isActionableFollowup(f: Record<string, unknown>): boolean {
  if (f.completedAt || f.pausedAt) return false;
  const status = typeof f.deliveryStatus === "string" ? f.deliveryStatus : "";
  return !["sent", "failed", "needs_retry", "cancelled"].includes(status);
}

function computeChannelMix(
  leads: readonly Record<string, unknown>[],
): Record<string, { count: number; won: number }> {
  const out: Record<string, { count: number; won: number }> = {};
  for (const lead of leads) {
    if (lead.intakeKind === "prospect") continue;
    const key = typeof lead.channel === "string" ? lead.channel : "";
    if (!key) continue;
    const row = out[key] ?? { count: 0, won: 0 };
    row.count += 1;
    if (lead.stage === "won") row.won += 1;
    out[key] = row;
  }
  return out;
}

function computeFunnelForChannel(
  channel: string,
  leads: readonly Record<string, unknown>[],
  deals: readonly Record<string, unknown>[],
): Record<string, number> {
  const stages = CHANNEL_FUNNEL_KEYS[channel] ?? [];
  const counts: Record<string, number> = Object.fromEntries(stages.map((s) => [s, 0]));
  const chLeads = leads.filter((l) => l.intakeKind !== "prospect" && l.channel === channel);
  const leadIds = new Set(chLeads.map((l) => String(l.id)));
  const chDeals = deals.filter((d) => leadIds.has(String(d.leadId ?? "")));
  const volume = chLeads.length;
  const firstKey = stages[0];
  if (firstKey && volume > 0) counts[firstKey] = volume;

  const meetingLeads = chLeads.filter((l) =>
    ["qualified", "discovery", "proposal", "negotiation"].includes(String(l.stage ?? "")),
  ).length;
  const winDeals = chDeals.filter((d) => d.stage === "won").length;

  if ("meeting" in counts) counts.meeting = Math.max(counts.meeting ?? 0, meetingLeads);
  if ("closed" in counts) counts.closed = Math.max(counts.closed ?? 0, winDeals);
  if (channel === "website_form") {
    counts.contacted = Math.max(
      counts.contacted ?? 0,
      chLeads.filter((l) => l.stage !== "new").length,
    );
  }
  if (channel === "upwork") {
    counts.hired = Math.max(counts.hired ?? 0, winDeals);
    counts.revenue = Math.max(counts.revenue ?? 0, winDeals);
  }

  let cap = Infinity;
  for (const s of stages) {
    const v = counts[s] ?? 0;
    const next = Math.min(v, cap);
    counts[s] = next;
    cap = next;
  }
  return counts;
}

export async function recomputeOrgDashboardSummaryForOrg(
  db: Firestore,
  organizationId: string,
): Promise<void> {
  const [leadsSnap, dealsSnap, followupsSnap] = await Promise.all([
    db.collection("leads").where("organizationId", "==", organizationId).get(),
    db.collection("deals").where("organizationId", "==", organizationId).get(),
    db.collection("followups").where("organizationId", "==", organizationId).get(),
  ]);

  const leads = leadsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as object) })) as Record<
    string,
    unknown
  >[];
  const deals = dealsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as object) })) as Record<
    string,
    unknown
  >[];
  const followups = followupsSnap.docs.map((doc) => doc.data() as Record<string, unknown>);

  const pipelineLeads: PipelineLeadFields[] = leads.map((d) => ({
    id: String(d.id),
    intakeKind: typeof d.intakeKind === "string" ? d.intakeKind : null,
    stage: typeof d.stage === "string" ? d.stage : null,
    estimatedValue: typeof d.estimatedValue === "number" ? d.estimatedValue : null,
  }));
  const pipelineDeals: PipelineDealFields[] = deals.map((d) => ({
    leadId: typeof d.leadId === "string" ? d.leadId : null,
    stage: typeof d.stage === "string" ? d.stage : null,
    value: typeof d.value === "number" ? d.value : null,
  }));

  let openSalesLeads = 0;
  let idleSalesLeads = 0;
  let prospects = 0;
  let prospectsNeedRouting = 0;
  let prospectsReadyToPush = 0;
  let prospectsPushed = 0;
  let totalReplies = 0;
  let repliesPendingReview = 0;

  for (const lead of leads) {
    const fields = {
      intakeKind: typeof lead.intakeKind === "string" ? lead.intakeKind : null,
      stage: typeof lead.stage === "string" ? lead.stage : null,
      isIdle: typeof lead.isIdle === "boolean" ? lead.isIdle : null,
    };
    if (leadCountsTowardOpenSalesLeads(fields)) openSalesLeads += 1;
    if (leadCountsTowardIdleSalesLeads(fields)) idleSalesLeads += 1;
    if (lead.intakeKind === "prospect") {
      prospects += 1;
      const assignments = Array.isArray(lead.prospectChannelAssignments)
        ? lead.prospectChannelAssignments
        : [];
      if (assignments.length === 0) prospectsNeedRouting += 1;
      else if (
        assignments.some(
          (a) => a && typeof a === "object" && !(a as { pushedAt?: unknown }).pushedAt,
        )
      ) {
        prospectsReadyToPush += 1;
      }
      if (lead.linkedSalesLeadId) prospectsPushed += 1;
    }
    const stage = typeof lead.stage === "string" ? lead.stage : "";
    if (lead.lastReplyAt || REPLIED_STAGES.has(stage)) totalReplies += 1;
    if (lead.replyReviewStatus === "pending") repliesPendingReview += 1;
  }

  const now = new Date();
  const nowMs = now.getTime();
  const startToday = startOfUtcDay(now);
  let followupsDue = 0;
  let overdueFollowups = 0;
  for (const f of followups) {
    if (!isActionableFollowup(f)) continue;
    const due = validTime(f.dueAt);
    if (due === undefined) continue;
    if (due <= startToday + 24 * 60 * 60 * 1000 - 1) {
      followupsDue += 1;
      if (due < startToday) overdueFollowups += 1;
    }
  }

  const gauges = computeOrgOpenPipelineGauges(pipelineLeads, pipelineDeals);
  const pipelineByStage = computePipelineByStage(pipelineLeads);
  const channelMix = computeChannelMix(leads);
  const funnelByChannel: Record<string, Record<string, number>> = {};
  for (const channel of Object.keys(CHANNEL_FUNNEL_KEYS)) {
    funnelByChannel[channel] = computeFunnelForChannel(channel, leads, deals);
  }

  const ranges: Record<string, Record<string, number>> = {};
  for (const key of RANGE_KEYS) {
    const start = rangeStartMs(key, now);
    let sent = 0;
    for (const f of followups) {
      const sentAt = validTime(f.sentAt);
      if (f.deliveryStatus === "sent" && sentAt !== undefined && sentAt >= start) sent += 1;
    }
    let replies = 0;
    let opens = 0;
    for (const lead of leads) {
      const repliedAt = validTime(lead.lastReplyAt);
      if (repliedAt !== undefined && repliedAt >= start) replies += 1;
      const openedAt = validTime(lead.lastEmailOpenedAt);
      if (openedAt !== undefined && openedAt >= start) opens += 1;
    }
    let closedRevenue = 0;
    let wonDealCount = 0;
    for (const deal of deals) {
      if (deal.stage !== "won") continue;
      if (key !== "all") {
        const wonAt = validTime(deal.wonAt);
        const updatedAt = validTime(deal.updatedAt);
        const createdAt = validTime(deal.createdAt);
        const inWindow =
          (wonAt !== undefined && wonAt >= start) ||
          (updatedAt !== undefined && updatedAt >= start) ||
          (createdAt !== undefined && createdAt >= start);
        if (!inWindow) continue;
      }
      closedRevenue += Number(deal.value) || 0;
      wonDealCount += 1;
    }
    ranges[key] = {
      sent,
      replies,
      opens,
      bounced: 0,
      closedRevenue,
      wonDealCount,
    };
  }

  const updatedAt = now.toISOString();
  const ref = db.collection(ORG_DASHBOARD_SUMMARIES).doc(organizationId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const payload = {
      id: organizationId,
      organizationId,
      version: ORG_DASHBOARD_SUMMARY_VERSION,
      updatedAt,
      openSalesLeads,
      idleSalesLeads,
      prospects,
      prospectsNeedRouting,
      prospectsReadyToPush,
      prospectsPushed,
      followupsDue,
      overdueFollowups,
      totalReplies,
      repliesPendingReview,
      ...gauges,
      pipelineByStage,
      channelMix,
      funnelByChannel,
      ranges,
    };
    if (!snap.exists) {
      tx.set(ref, { ...emptyOrgDashboardSummary(organizationId, updatedAt), ...payload });
      return;
    }
    tx.set(ref, payload, { merge: true });
  });

  void nowMs;
}

/**
 * P3.4 — route summary refresh by `ORG_DASHBOARD_SUMMARY_STORE`.
 * Default `postgres`: notify App Hosting (no Firestore write).
 */
export async function refreshOrgDashboardSummaryAfterWrite(
  db: Firestore,
  organizationId: string,
  storeRaw?: string,
): Promise<void> {
  const orgId = organizationId.trim();
  if (!orgId) return;

  const {
    normalizeOrgDashboardSummaryStore,
    notifyAppHostingOrgDashboardSummaryRecompute,
  } = await import("./orgDashboardSummaryNotify");
  const store = normalizeOrgDashboardSummaryStore(storeRaw);

  if (store === "firestore" || store === "dual") {
    await recomputeOrgDashboardSummaryForOrg(db, orgId);
  }
  if (store === "postgres" || store === "dual") {
    await notifyAppHostingOrgDashboardSummaryRecompute(orgId);
  }
}
