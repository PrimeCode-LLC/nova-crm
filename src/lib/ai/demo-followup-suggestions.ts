import type { ChannelKey, Lead } from "@/lib/types";

export type FollowupSuggestResponse = {
  planSummary: string;
  items: {
    title: string;
    offsetDays: number;
    priority: "low" | "medium" | "high" | "urgent";
    channel: ChannelKey | "other";
    messageBody: string;
    description: string;
    rationale: string;
  }[];
  leadChannel: ChannelKey;
};

export function demoFollowupSuggestions(
  lead: Lead,
  userPrompt?: string,
): FollowupSuggestResponse {
  const name = lead.contactName.split(" ")[0] || lead.contactName;
  const company = lead.companyName;
  const channel = lead.channel;
  const hint = userPrompt?.trim() ? ` (${userPrompt.trim()})` : "";

  const upworkCopy =
    channel === "upwork"
      ? `Hi ${name} — following up on our conversation about ${company}. Happy to clarify scope or share a short case study if useful.`
      : `Hi ${name}, checking in on our thread with ${company}. Let me know if timing still works on your side.`;

  return {
    planSummary: `Demo plan for ${lead.contactName}: two touchpoints on ${channel}${hint}.`,
    leadChannel: channel,
    items: [
      {
        title: `Follow up with ${lead.contactName}`,
        offsetDays: 2,
        priority: "high",
        channel: channel === "upwork" ? "upwork" : "other",
        messageBody: upworkCopy,
        description: "First nudge after last activity",
        rationale: "Lead has gone quiet; short personalized check-in",
      },
      {
        title: `Second touch — ${company}`,
        offsetDays: 7,
        priority: "medium",
        channel: "other",
        messageBody:
          channel === "linkedin_outbound" || channel === "linkedin_1to1"
            ? `Hi ${name} — still interested in connecting about ${company}. Open to a 15-min call if easier than async.`
            : `Hi ${name},\n\nCircling back once more in case my last note missed your inbox. If priorities shifted at ${company}, no worries — just let me know.`,
        description: "Break-up or value-add follow-up",
        rationale: "Give one more beat before marking cold",
      },
    ],
  };
}
