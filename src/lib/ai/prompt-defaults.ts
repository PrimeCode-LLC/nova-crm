import type { AiFeatureKey, AiRagMode } from "@/lib/ai/types";

export const AI_PROMPT_DEFAULTS: Record<
  AiFeatureKey,
  { systemPrompt: string; userPromptTemplate: string }
> = {
  dashboard_brief: {
    systemPrompt: `You are a sales operations analyst for a B2B CRM. You only analyze the scoped snapshot in the user message (owner, date range, channels). Never mention leads, people, or tasks that are not in that scope. Output structured JSON only.`,
    userPromptTemplate: `Analyze this CRM snapshot for the active dashboard filters.

Filters: {{filters}}

Data:
{{context}}

Return JSON with:
- progress: string (2-4 sentences on what is moving for this scoped owner/period only)
- risks: string[] (3-6 concrete risks from scoped data only)
- suggestions: string[] (3-6 prioritized actions for this owner/period)
- watchList: { title: string, reason: string, href: string | null }[] (up to 5 items)

Watch list: return an empty array []; the server builds the watch list from watchListCandidates.`,
  },
  lead_analyze: {
    systemPrompt: `You are a sales coach reviewing a single lead record. Use all provided CRM and email context. Be constructive; note wins, issues, and improvements. Output structured JSON only.`,
    userPromptTemplate: `Analyze this lead comprehensively (any stage including closed/lost).

Lead context:
{{context}}

{{ragBlock}}

Return JSON with:
- summary: string
- wins: string[]
- issues: string[]
- improvements: string[]
- riskLevel: "low" | "medium" | "high"
- nextActions: string[]`,
  },
  followup_suggest: {
    systemPrompt: `You are a B2B sales follow-up planner. Propose a short sequence of dated follow-ups with ready-to-send message copy for the lead's primary channel. Respect existing open follow-ups—extend the cadence, do not duplicate the same step. If regenerateContext is provided, the lead replied—draft a fresh plan that acknowledges their message and proposes next steps. Output structured JSON only. Never invent facts not in context.`,
    userPromptTemplate: `Plan follow-ups for this lead.

User instructions (may be empty):
{{userPrompt}}

Regenerate context (if replanning after a lead reply):
{{regenerateBlock}}

Lead context:
{{context}}

{{ragBlock}}

Return JSON with:
- planSummary: string (1-2 sentences)
- items: array of 2-6 objects, each with:
  - title: string (short reminder title)
  - offsetDays: integer (0 = today, days from today for due date)
  - priority: "low" | "medium" | "high" | "urgent"
  - channel: one of "cold_email" | "linkedin_outbound" | "linkedin_1to1" | "personalized_email" | "website_form" | "upwork" | "job_apply" | "other" (prefer lead channel or "other")
  - messageBody: string (full outbound text to copy-paste; match channel tone)
  - description: string (internal note for the rep; use "" if none)
  - rationale: string (why this step; use "" if none)`,
  },
  email_reply: {
    systemPrompt: `You are drafting a professional sales email reply. Match the thread tone. Do not invent facts not in context. Output only the email body text (no subject line unless asked).`,
    userPromptTemplate: `Draft a reply for this email thread.

Tone: {{tone}}
Goal: {{goal}}

Thread:
{{thread}}

Lead context (if any):
{{leadContext}}

{{ragBlock}}

Write the reply body only.`,
  },
  rag_index: {
    systemPrompt: `Indexing task — not used for generation.`,
    userPromptTemplate: `{{content}}`,
  },
};

export function buildRagInstructionBlock(mode: AiRagMode, chunks: { title: string; content: string }[]): string {
  if (mode === "open" || chunks.length === 0) return "";
  const corpus = chunks
    .map((c, i) => `[${i + 1}] ${c.title}\n${c.content}`)
    .join("\n\n");
  if (mode === "strict") {
    return `Knowledge base (answer ONLY from this; if insufficient say what is missing):\n${corpus}`;
  }
  return `Reference knowledge (prefer this over general knowledge when relevant):\n${corpus}`;
}

export function interpolatePrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}
