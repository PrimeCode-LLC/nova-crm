import type { ChannelKey, FollowupChannel, FollowupSequenceMode, Lead } from "@/lib/types";
import {
  buildFollowupPersonalizationProfile,
  type FollowupRoleFamily,
} from "@/lib/ai/followup-personalization";

export type FollowupSuggestResponse = {
  planSummary: string;
  items: {
    title: string;
    offsetDays: number;
    priority: "low" | "medium" | "high" | "urgent";
    channel: FollowupChannel;
    emailSubject?: string;
    messageBody: string;
    description: string;
    rationale: string;
  }[];
  leadChannel: ChannelKey;
  sequenceMode: FollowupSequenceMode;
};

function isEmailishChannel(channel: ChannelKey): boolean {
  return (
    channel === "cold_email" ||
    channel === "personalized_email" ||
    channel === "website_form"
  );
}

function cleanSignal(value: string): string {
  const cleaned = value.trim().replace(/[.!?]+$/, "");
  return cleaned.length > 180 ? `${cleaned.slice(0, 177).trimEnd()}…` : cleaned;
}

function getDemoSignal(lead: Lead): string | undefined {
  if (lead.recentNews) return `I saw the recent update: ${cleanSignal(lead.recentNews)}.`;
  if (lead.triggerEvent) return `I noticed ${cleanSignal(lead.triggerEvent)}.`;
  if (lead.hiringSignals) return `I noticed ${cleanSignal(lead.hiringSignals)}.`;
  if (lead.businessFocus) {
    return `${lead.companyName}'s focus on ${cleanSignal(lead.businessFocus)} stood out.`;
  }
  if (lead.painPoints) return `You mentioned ${cleanSignal(lead.painPoints)}.`;
  if (lead.toolsUsed?.length) {
    return `I noticed ${lead.companyName} uses ${lead.toolsUsed.slice(0, 3).join(", ")}.`;
  }
  return undefined;
}

const ROLE_COPY: Record<
  FollowupRoleFamily,
  { relevance: string; offer: string; subject: string }
> = {
  executive: {
    relevance: "There may be a direct way to improve the business outcome without adding management overhead.",
    offer: "I can keep this to the decision, likely impact, and tradeoffs.",
    subject: "one quick question",
  },
  technical_executive: {
    relevance: "This may be relevant to integration effort, delivery risk, and technical leverage.",
    offer: "I can share a concise technical overview covering workflow and integration.",
    subject: "technical fit",
  },
  technical_practitioner: {
    relevance: "This may be useful at the workflow and implementation level.",
    offer: "I can share a concrete example with the mechanism and setup involved.",
    subject: "implementation question",
  },
  operations: {
    relevance: "This may help reduce process friction while keeping the workflow reliable.",
    offer: "I can share a short example focused on time saved and adoption.",
    subject: "workflow question",
  },
  revenue: {
    relevance: "This may be useful for improving pipeline speed and conversion without adding manual work.",
    offer: "I can share a short example focused on the measurable revenue workflow.",
    subject: "pipeline question",
  },
  finance: {
    relevance: "The useful question is whether the economic impact and risk justify a closer look.",
    offer: "I can share a concise view of cost, expected impact, and tradeoffs.",
    subject: "business case",
  },
  people: {
    relevance: "This may help improve team capacity and experience without creating another heavy process.",
    offer: "I can share a practical example focused on adoption and time saved.",
    subject: "team workflow",
  },
  general: {
    relevance: "There may be a practical opportunity worth comparing against your current approach.",
    offer: "I can share a concise example if that would be useful.",
    subject: "quick question",
  },
};

export function demoFollowupSuggestions(
  lead: Lead,
  userPrompt?: string,
  sequenceMode: FollowupSequenceMode = "full",
): FollowupSuggestResponse {
  const name = lead.contactName.split(" ")[0] || lead.contactName;
  const company = lead.companyName;
  const channel = lead.channel;
  const hint = userPrompt?.trim() ? ` (${userPrompt.trim()})` : "";
  const emailish = isEmailishChannel(channel);
  const continueMode = sequenceMode === "continue";
  const emailChannel: FollowupChannel = emailish ? channel : "personalized_email";
  const profile = buildFollowupPersonalizationProfile({ title: lead.contactTitle });
  const roleCopy = ROLE_COPY[profile.roleFamily];
  const signal = getDemoSignal(lead);
  const relevanceOpener = signal ?? `I wanted to send a direct note about ${company}.`;

  const step1Body =
    channel === "upwork"
      ? `Hi ${name}, following up on our conversation about ${company}. Happy to clarify scope or share a short case study if useful.`
      : continueMode
        ? `Hi ${name},\n\nCircling back on my note about ${company}. ${roleCopy.offer}\n\nWould that be useful?`
        : `Hi ${name},\n\n${relevanceOpener} ${roleCopy.relevance}\n\nOpen to a brief conversation?`;

  const step2Body =
    channel === "linkedin_outbound" || channel === "linkedin_1to1"
      ? `Hi ${name}, following up on ${company}. ${roleCopy.offer} Useful to connect?`
      : `Hi ${name},\n\nOne useful follow-up to my earlier note: ${roleCopy.offer}\n\nWorth sending over?`;

  const items: FollowupSuggestResponse["items"] = [];

  if (!continueMode) {
    items.push({
      title: emailish ? `Email 1 — Intro to ${name}` : `Touch 1 — Reach ${name}`,
      offsetDays: 0,
      priority: "high",
      channel: emailish ? emailChannel : channel,
      emailSubject: emailish ? `${company} — ${roleCopy.subject}` : undefined,
      messageBody: step1Body,
      description: "First personalized touch",
      rationale: "Open the thread with a specific hook",
    });
  }

  items.push({
    title: continueMode
      ? emailish
        ? `Email 2 — Value bump for ${company}`
        : `Follow-up with ${name}`
      : emailish
        ? `Email 2 — Value bump`
        : `Second touch, ${company}`,
    offsetDays: continueMode ? 2 : 3,
    priority: "high",
    channel: emailish ? emailChannel : channel === "upwork" ? "upwork" : "other",
    emailSubject: emailish ? `Re: ${company} — helpful next step` : undefined,
    messageBody: continueMode ? step1Body : step2Body,
    description: continueMode ? "Next touch after intro already sent" : "First nudge after opener",
    rationale: continueMode
      ? "Lead already received intro; continue the thread"
      : "Give the thread a second beat",
  });

  items.push({
    title: emailish
      ? `Email ${continueMode ? "3" : "3"} — Break-up`
      : `Final check-in, ${company}`,
    offsetDays: continueMode ? 7 : 10,
    priority: "medium",
    channel: emailish ? emailChannel : "other",
    emailSubject: emailish ? `Should I close the loop on ${company}?` : undefined,
    messageBody:
      channel === "linkedin_outbound" || channel === "linkedin_1to1"
        ? `Hi ${name}, last ping from me on ${company}. If timing is off, I'll check back later.`
        : `Hi ${name},\n\nI'll close the loop on my side unless you want to reopen. If ${company} still wants help later, just reply here.`,
    description: "Break-up or soft close",
    rationale: "One more beat before marking cold",
  });

  return {
    planSummary: continueMode
      ? `Demo continue sequence for ${lead.contactName} on ${channel}${hint} (intro already sent).`
      : `Demo full sequence for ${lead.contactName}: personalized touches on ${channel}${hint}.`,
    leadChannel: channel,
    sequenceMode,
    items,
  };
}
