import type { ChannelKey, PipelineStage } from "./types";

const EARLY: PipelineStage[] = ["new", "viewed", "contacted"];
const POST_CONTACT: PipelineStage[] = ["viewed", "contacted", "replied", "qualified", "discovery", "proposal", "negotiation", "won"];
const POST_REPLY: PipelineStage[] = ["replied", "qualified", "discovery", "proposal", "negotiation", "won"];
const MEETING_LIKE: PipelineStage[] = ["qualified", "discovery", "proposal", "negotiation"];

/**
 * Maps dashboard funnel step keys (mostly activity-based) to pipeline stages
 * for a reasonable "drill into leads" list filter.
 */
export function funnelDrillPipelineStages(funnelKey: string): PipelineStage[] | null {
  switch (funnelKey) {
    case "closed":
    case "revenue":
    case "hired":
    case "offer":
      return ["won"];
    case "meeting":
      return [...MEETING_LIKE, "won"];
    case "interview":
      return MEETING_LIKE;
    case "replied":
    case "recruiter_reply":
      return POST_REPLY;
    case "contacted":
      return POST_CONTACT;
    case "qualified":
      return ["qualified", "discovery", "proposal", "negotiation", "won"];
    case "discovery":
      return ["discovery", "proposal", "negotiation", "won"];
    case "proposal":
      return ["proposal", "negotiation", "won"];
    case "negotiation":
      return ["negotiation", "won"];
    case "sent":
    case "opened":
    case "clicked":
    case "connection_sent":
    case "accepted":
    case "messaged":
    case "applied":
    case "viewed":
    case "submitted":
      return EARLY;
    default:
      return null;
  }
}

export function buildFunnelDrillHref(channel: ChannelKey, funnelKey: string): string {
  const stages = funnelDrillPipelineStages(funnelKey);
  const p = new URLSearchParams();
  p.set("channel", channel);
  if (stages?.length) {
    for (const s of stages) p.append("stage", s);
  }
  return `/leads?${p.toString()}`;
}
