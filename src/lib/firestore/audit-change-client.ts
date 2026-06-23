import type { ChannelKey, PipelineStage } from "@/lib/types";

function postAuditEvent(body: Record<string, unknown>): void {
  void fetch("/api/org/audit/change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    /* audit must not block CRM writes */
  });
}

/** Non-blocking org audit log for CRM field changes (stage, etc.). */
export function recordLeadStageChangeClient(input: {
  leadId: string;
  leadName?: string;
  prevStage: PipelineStage;
  nextStage: PipelineStage;
  isProspect?: boolean;
  channel?: ChannelKey;
}): void {
  if (input.prevStage === input.nextStage) return;

  postAuditEvent({
    event: "lead.stage_changed",
    leadId: input.leadId,
    leadName: input.leadName,
    prevStage: input.prevStage,
    nextStage: input.nextStage,
    tableName: input.isProspect ? "prospects" : "leads",
    channel: input.channel,
  });
}

export function recordLeadCreatedClient(input: {
  leadId: string;
  leadName?: string;
  channel?: ChannelKey;
  isProspect?: boolean;
}): void {
  postAuditEvent({
    event: "lead.created",
    leadId: input.leadId,
    leadName: input.leadName,
    channel: input.channel,
    tableName: input.isProspect ? "prospects" : "leads",
  });
}

export function recordDealCreatedClient(input: {
  dealId: string;
  dealName?: string;
  leadId?: string;
  channel?: ChannelKey;
}): void {
  postAuditEvent({
    event: "deal.created",
    dealId: input.dealId,
    dealName: input.dealName,
    leadId: input.leadId,
    channel: input.channel,
  });
}

export function recordDealStageChangeClient(input: {
  dealId: string;
  dealName?: string;
  prevStage: PipelineStage;
  nextStage: PipelineStage;
  channel?: ChannelKey;
}): void {
  if (input.prevStage === input.nextStage) return;

  const event =
    input.nextStage === "won"
      ? "deal.won"
      : input.nextStage === "lost"
        ? "deal.lost"
        : "deal.stage_changed";

  postAuditEvent({
    event,
    dealId: input.dealId,
    dealName: input.dealName,
    prevStage: input.prevStage,
    nextStage: input.nextStage,
    channel: input.channel,
  });
}

export function recordActivityCounterLoggedClient(input: {
  channel: ChannelKey | string;
  date: string;
  counters: Record<string, number>;
  profileId?: string;
}): void {
  postAuditEvent({
    event: "activity.counter_logged",
    channel: input.channel,
    date: input.date,
    counters: input.counters,
    profileId: input.profileId,
  });
}
