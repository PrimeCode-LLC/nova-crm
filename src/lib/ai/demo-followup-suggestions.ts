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
  if (lead.recentNews) return `Saw the update on ${cleanSignal(lead.recentNews)}.`;
  if (lead.triggerEvent) return `Noticed ${cleanSignal(lead.triggerEvent)}.`;
  if (lead.hiringSignals) return `Noticed ${cleanSignal(lead.hiringSignals)}.`;
  if (lead.businessFocus) {
    return `${lead.companyName}'s focus on ${cleanSignal(lead.businessFocus)} stood out.`;
  }
  if (lead.painPoints) return `You mentioned ${cleanSignal(lead.painPoints)}.`;
  if (lead.toolsUsed?.length) {
    return `Noticed ${lead.companyName} uses ${lead.toolsUsed.slice(0, 3).join(", ")}.`;
  }
  return undefined;
}

const ROLE_COPY: Record<
  FollowupRoleFamily,
  { relevance: string; offer: string; subject: string; interestAsk: string }
> = {
  executive: {
    relevance: "There may be a direct way to improve the outcome without adding management overhead.",
    offer: "Happy to share the decision tradeoffs in two lines.",
    subject: "timing on this",
    interestAsk: "Worth a look?",
  },
  technical_executive: {
    relevance: "This may affect integration effort, delivery risk, and technical leverage.",
    offer: "I can share a short technical overview of workflow and integration.",
    subject: "technical fit",
    interestAsk: "Open to a 2-line overview?",
  },
  technical_practitioner: {
    relevance: "This may be useful at the workflow and implementation level.",
    offer: "I can share a concrete example with the mechanism and setup.",
    subject: "implementation note",
    interestAsk: "Want the example?",
  },
  operations: {
    relevance: "This may reduce process friction while keeping the workflow reliable.",
    offer: "I can share a short example focused on time saved and adoption.",
    subject: "workflow idea",
    interestAsk: "Useful to see?",
  },
  revenue: {
    relevance: "This may help pipeline speed and conversion without more manual work.",
    offer: "I can share a short example of the measurable workflow.",
    subject: "pipeline idea",
    interestAsk: "Worth comparing?",
  },
  finance: {
    relevance: "The useful question is whether the economic impact and risk justify a closer look.",
    offer: "I can share a concise view of cost, expected impact, and tradeoffs.",
    subject: "business case",
    interestAsk: "Want the short version?",
  },
  people: {
    relevance: "This may help team capacity and experience without another heavy process.",
    offer: "I can share a practical example focused on adoption and time saved.",
    subject: "team workflow",
    interestAsk: "Open to a short example?",
  },
  general: {
    relevance: "There may be a practical opportunity worth comparing against your current approach.",
    offer: "I can share a concise example if useful.",
    subject: "one idea",
    interestAsk: "Worth a look?",
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
  const relevanceOpener = signal ?? `A note on ${company}.`;

  const step1Body =
    channel === "upwork"
      ? `Hi ${name},\n\nOn ${company}: happy to clarify scope or share a short case study if useful.\n\n${roleCopy.interestAsk}`
      : continueMode
        ? `Hi ${name},\n\nOn my earlier note about ${company}: ${roleCopy.offer}\n\n${roleCopy.interestAsk}`
        : `Hi ${name},\n\n${relevanceOpener} ${roleCopy.relevance}\n\n${roleCopy.interestAsk}`;

  const step2Body =
    channel === "linkedin_outbound" || channel === "linkedin_1to1"
      ? `Hi ${name} — on ${company}: ${roleCopy.offer} Useful to connect?`
      : `Hi ${name},\n\nOne new angle on ${company}: ${roleCopy.offer}\n\nWant me to send it over?`;

  const step3Body =
    channel === "linkedin_outbound" || channel === "linkedin_1to1"
      ? `Hi ${name}, last note from me on ${company}. If timing is off, just say no and I'll close the loop.`
      : `Hi ${name},\n\nI'll close the loop on my side unless you want to reopen. If ${company} still wants help later, reply here.`;

  const items: FollowupSuggestResponse["items"] = [];

  // offsetDays mirrors relative business-day gaps (UI assigns dates via dateInputForSequenceStep):
  // Full: Day 0 → +3 BD → +5 BD → +7 BD. Continue: +3 BD → +5 BD → +7 BD.
  if (!continueMode) {
    items.push({
      title: emailish ? `Email 1 — Intro to ${name}` : `Touch 1 — Reach ${name}`,
      offsetDays: 0,
      priority: "high",
      channel: emailish ? emailChannel : channel,
      emailSubject: emailish ? roleCopy.subject : undefined,
      messageBody: step1Body,
      description: "First personalized touch",
      rationale: "Open with a specific hook and soft interest check",
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
    offsetDays: 3,
    priority: "high",
    channel: emailish ? emailChannel : channel === "upwork" ? "upwork" : "other",
    emailSubject: emailish ? roleCopy.subject : undefined,
    messageBody: continueMode ? step1Body : step2Body,
    description: continueMode ? "Next touch after intro already sent" : "Proof/insight beat",
    rationale: continueMode
      ? "Lead already received intro; continue the thread"
      : "Add a new angle without repeating the opener",
  });

  items.push({
    title: emailish
      ? `Email ${continueMode ? "3" : "3"} — Break-up`
      : `Final check-in, ${company}`,
    offsetDays: 5,
    priority: "medium",
    channel: emailish ? emailChannel : "other",
    emailSubject: emailish ? `closing the loop` : undefined,
    messageBody: step3Body,
    description: "Break-up / permission to decline",
    rationale: "Easy out recovers silent prospects",
  });

  items.push({
    title: emailish ? `Email ${continueMode ? "4" : "4"} — Final nudge` : `Last touch, ${company}`,
    offsetDays: 7,
    priority: "medium",
    channel: emailish ? emailChannel : "other",
    emailSubject: emailish ? `last note` : undefined,
    messageBody:
      channel === "linkedin_outbound" || channel === "linkedin_1to1"
        ? `Hi ${name}, last note from me on ${company}. Happy to reconnect whenever timing is better.`
        : `Hi ${name},\n\nLast note from me on ${company}. If a better time opens up, reply here.`,
    description: "Final follow-up in the cadence",
    rationale: "Complete the +3 / +5 / +7 business-day cadence",
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
