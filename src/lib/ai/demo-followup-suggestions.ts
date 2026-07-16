import type { ChannelKey, FollowupChannel, FollowupSequenceMode, Lead } from "@/lib/types";

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

  const step1Body =
    channel === "upwork"
      ? `Hi ${name}, following up on our conversation about ${company}. Happy to clarify scope or share a short case study if useful.`
      : continueMode
        ? `Hi ${name},\n\nCircling back on my note about ${company}. Happy to share a short example if that helps next steps.`
        : `Hi ${name},\n\nI noticed ${company} and thought it was worth a quick intro. We help teams like yours move faster — open to a brief chat?`;

  const step2Body =
    channel === "linkedin_outbound" || channel === "linkedin_1to1"
      ? `Hi ${name}, still interested in connecting about ${company}. Open to a 15-min call if easier than async.`
      : `Hi ${name},\n\nCircling back once more in case my last note missed your inbox. If priorities shifted at ${company}, no worries — just let me know.`;

  const items: FollowupSuggestResponse["items"] = [];

  if (!continueMode) {
    items.push({
      title: emailish ? `Email 1 — Intro to ${name}` : `Touch 1 — Reach ${name}`,
      offsetDays: 0,
      priority: "high",
      channel: emailish ? emailChannel : channel,
      emailSubject: emailish ? `${company} — quick intro` : undefined,
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
