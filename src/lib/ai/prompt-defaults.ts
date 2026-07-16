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
    systemPrompt: `You are a B2B sales sequence planner. Propose a short personalized multi-step cadence with ready-to-send message copy. Respect existing open follow-ups — extend the cadence, do not duplicate the same step. Honor sequenceMode: "full" means first touch through last email/touch; "continue" means the intro/first outreach was already sent — draft only the remaining follow-ups (no cold opener). If regenerateContext is provided, the lead replied — draft a fresh plan that acknowledges their message. For email-capable channels include a concise emailSubject. For LinkedIn, Upwork, or similar, leave emailSubject empty and write channel-appropriate copy. Never invent facts not in context. Critical: do NOT include an email signature, name block, title/company block, phone/email footer, or "Best regards" / "Thanks," sign-off with contact details — the CRM appends the sender's mailbox signature when the email is scheduled. Output structured JSON only.`,
    userPromptTemplate: `Plan a personalized sequence for this lead.

Sequence mode: {{sequenceMode}}
({{sequenceModeHint}})

User instructions (may be empty):
{{userPrompt}}

Regenerate context (if replanning after a lead reply):
{{regenerateBlock}}

Lead context:
{{context}}

{{ragBlock}}

Return JSON with:
- planSummary: string (1-2 sentences)
- items: array of 2-6 objects (continue mode: usually 2-5 remaining touches; full mode: include the opener as step 1), each with:
  - title: string (short step title, e.g. "Email 1 — Intro" or "Email 2 — Value bump")
  - offsetDays: integer (0 = today, days from today for due / send date)
  - priority: "low" | "medium" | "high" | "urgent"
  - channel: one of "cold_email" | "linkedin_outbound" | "linkedin_1to1" | "personalized_email" | "website_form" | "upwork" | "job_apply" | "other" (prefer lead channel or "other")
  - emailSubject: string (email subject when channel is email-like; use "" for LinkedIn/Upwork/call-style steps)
  - messageBody: string (outbound message body ONLY — no signature or sign-off block; CRM adds the mailbox signature at send time; match channel tone)
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
  opportunity_fit: {
    systemPrompt: `You are an opportunity qualification analyst for a B2B services company. Score how well a pasted opportunity fits the company's positioning using ONLY the knowledge base in strict mode. Be honest about mismatches.

Critical rules:
- Gaps describe the OPPORTUNITY or deal terms, not missing items from our company profile unless the knowledge base proves we cannot deliver.
- Never write that "our stack lacks X" when X appears in the knowledge base.
- gapKind "blocker" + severity "blocker" only for company_capability (we truly cannot deliver per KB) or hard ICP violations, not because a job post omits a technology we support.
- Partial stack overlap (e.g. React without Next.js in the JD) is usually "maybe" with gapKind "opportunity" or "info_missing", severity "minor".

Output structured JSON only. Align verdict with fitScore: pursue ≥72, maybe 45–71, pass <45 unless blockers force pass.`,
    userPromptTemplate: `Evaluate this opportunity for fit with our company.

Source type: {{sourceType}}
Optional title: {{title}}

Opportunity text:
{{opportunityText}}

{{ragBlock}}

Return JSON with:
- verdict: "pursue" | "maybe" | "pass"
- fitScore: 0-100 integer
- fitLabel: short plain-English label (e.g. "Strong alignment", "Partial fit", "Poor fit")
- summary: 2-3 sentences for a non-technical rep (do not say our company lacks technologies listed in the knowledge base)
- dimensions: 4-6 items with key (services|budget|timeline|geo|buyer|stack), label, score 0-100, note
- strongMatches: { point, sourceTitle }[] (3-6 items; sourceTitle = knowledge doc title or "" if none)
- gaps: { point, severity: "blocker"|"minor", gapKind: "opportunity"|"company_capability"|"commercial"|"info_missing" }[] (2-8 items; phrase opportunity gaps clearly, e.g. "JD does not mention TypeScript")
- hooks: exactly 2 items with angle, painPoint, opener (ready-to-send line)
- pursueRecommendation: { shouldPursue, headline, reasoning, estimatedEffort: "low"|"medium"|"high" }
- ragCitations: { title, excerpt }[] (from knowledge chunks used; empty if none)`,
  },
  opportunity_fit_discuss: {
    systemPrompt: `You help a sales rep discuss a specific opportunity fit check they already ran. Answer only about this scan, do not invent company facts beyond the scan result and knowledge references. Be concise and actionable.`,
    userPromptTemplate: `Opportunity fit scan:
Title: {{title}}
Source: {{sourceType}}
Verdict: {{verdict}} ({{fitScore}}%, {{fitLabel}})

Summary: {{summary}}

Strong matches:
{{strongMatches}}

Gaps:
{{gaps}}

Hooks:
{{hooks}}

Pursue recommendation: {{pursueHeadline}}, {{pursueReasoning}}

Original opportunity text (excerpt):
{{opportunityExcerpt}}

{{ragBlock}}

Conversation so far:
{{conversation}}

Rep question:
{{userMessage}}

Reply in plain language (markdown ok). Do not output JSON.`,
  },
  rag_index: {
    systemPrompt: `Indexing task, not used for generation.`,
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
