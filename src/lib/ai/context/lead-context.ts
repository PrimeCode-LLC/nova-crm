import type {
  Account,
  Contact,
  Deal,
  Followup,
  Lead,
  LeadTask,
  Note,
  TimelineEvent,
  Touchpoint,
} from "@/lib/types";

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
}): string {
  const { lead, account, contact, deal, notes, timeline, touchpoints, followups, tasks } = input;
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
      psLine: lead.psLine,
      bant: lead.bant,
    },
    account: account
      ? { name: account.name, industry: account.industry, domain: account.domain }
      : null,
    contact: contact
      ? { name: contact.fullName, email: contact.email, title: contact.title }
      : null,
    deal: deal
      ? { stage: deal.stage, value: deal.value, expectedCloseDate: deal.expectedCloseDate }
      : null,
    notes: notes.slice(-15).map((n) => ({ body: n.body.slice(0, 500), createdAt: n.createdAt })),
    timeline: timeline.slice(-20).map((t) => ({ type: t.type, summary: t.summary, createdAt: t.createdAt })),
    touchpoints: touchpoints.slice(-15).map((t) => ({ state: t.state, summary: t.summary, occurredAt: t.occurredAt })),
    followups: followups
      .filter((f) => !f.completedAt)
      .slice(0, 10)
      .map((f) => ({ title: f.title, dueAt: f.dueAt, priority: f.priority })),
    tasks: tasks
      .filter((t) => !t.completedAt)
      .slice(0, 10)
      .map((t) => ({ title: t.title, dueAt: t.dueAt })),
    emailThreads: input.emailThreads ?? [],
  };
  const json = JSON.stringify(payload);
  return json.length > 16_000 ? json.slice(0, 16_000) + "…[truncated]" : json;
}
