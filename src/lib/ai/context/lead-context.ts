import type {
  Account,
  Contact,
  Deal,
  Followup,
  FollowupPlan,
  Lead,
  LeadTask,
  Note,
  TimelineEvent,
  Touchpoint,
} from "@/lib/types";
import { buildFollowupPersonalizationProfile } from "@/lib/ai/followup-personalization";

export function buildLeadAiContext(input: {
  lead: Lead;
  account?: Account;
  contact?: Contact;
  deal?: Deal;
  notes: Note[];
  timeline: TimelineEvent[];
  touchpoints: Touchpoint[];
  followups: Followup[];
  tasks: LeadTask[];
  emailThreads?: { subject: string; messages: { from: string; date: string; snippet: string }[] }[];
  followupPlans?: FollowupPlan[];
  regenerateContext?: string;
}): string {
  const { lead, account, contact, deal, notes, timeline, touchpoints, followups, tasks } = input;
  const contactName = contact?.fullName?.trim() || lead.contactName;
  const contactEmail = contact?.email?.trim() || lead.contactEmail;
  const contactTitle = contact?.title?.trim() || lead.contactTitle;
  const personalizationProfile = buildFollowupPersonalizationProfile({
    title: contactTitle,
    seniority: contact?.seniority,
  });
  const payload = {
    lead: {
      id: lead.id,
      stage: lead.stage,
      channel: lead.channel,
      ownerId: lead.ownerId,
      campaignId: lead.campaignId,
      profileId: lead.profileId,
      estimatedValue: lead.estimatedValue,
      responseTimeMinutes: lead.responseTimeMinutes,
      touches: lead.touches,
      isIdle: lead.isIdle,
      lastActivityAt: lead.lastActivityAt,
      painPoints: lead.painPoints,
      triggerEvent: lead.triggerEvent,
      businessFocus: lead.businessFocus,
      hiringSignals: lead.hiringSignals,
      recentNews: lead.recentNews,
      psLine: lead.psLine,
      toolsUsed: lead.toolsUsed,
      bant: lead.bant,
    },
    account: {
      name: account?.name || lead.companyName,
      industry: account?.industry || lead.companyIndustry,
      domain: account?.domain || lead.companyDomain,
      companySize: lead.companySize,
      revenueRange: lead.revenueRange,
    },
    contact: {
      name: contactName,
      email: contactEmail,
      title: contactTitle,
      seniority: contact?.seniority,
    },
    personalizationProfile,
    deal: deal
      ? { stage: deal.stage, value: deal.value, expectedCloseDate: deal.expectedCloseDate }
      : null,
    notes: notes.slice(-15).map((n) => ({ body: n.body.slice(0, 500), createdAt: n.createdAt })),
    timeline: timeline.slice(-20).map((t) => ({ type: t.type, summary: t.summary, createdAt: t.createdAt })),
    touchpoints: touchpoints.slice(-15).map((t) => ({ state: t.state, summary: t.summary, occurredAt: t.occurredAt })),
    followups: followups
      .filter((f) => !f.completedAt)
      .slice(0, 10)
      .map((f) => ({
        title: f.title,
        dueAt: f.dueAt,
        priority: f.priority,
        channel: f.channel,
        description: f.description?.slice(0, 200),
        hasMessageBody: Boolean(f.messageBody),
      })),
    tasks: tasks
      .filter((t) => !t.completedAt)
      .slice(0, 10)
      .map((t) => ({ title: t.title, dueAt: t.dueAt })),
    emailThreads: input.emailThreads ?? [],
    followupPlans: (input.followupPlans ?? []).slice(0, 5).map((p) => ({
      id: p.id,
      status: p.status,
      planSummary: p.planSummary.slice(0, 300),
      pausedReason: p.pausedReason?.slice(0, 200),
      pausedAt: p.pausedAt,
    })),
    regenerateContext: input.regenerateContext?.slice(0, 800) ?? null,
  };
  const json = JSON.stringify(payload);
  return json.length > 16_000 ? json.slice(0, 16_000) + "…[truncated]" : json;
}
