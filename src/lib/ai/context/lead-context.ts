import type {
  Account,
  Campaign,
  Contact,
  CrmLabel,
  Deal,
  Followup,
  FollowupPlan,
  Lead,
  LeadTask,
  Note,
  Profile,
  ScriptLibraryItem,
  TimelineEvent,
  Touchpoint,
} from "@/lib/types";
import { buildFollowupPersonalizationProfile } from "@/lib/ai/followup-personalization";
import type {
  BuyerPersona,
  ProspectingStrategy,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";

const MAX_CONTEXT_STRING_LENGTH = 2_000;

function contextValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return value.length > MAX_CONTEXT_STRING_LENGTH
      ? `${value.slice(0, MAX_CONTEXT_STRING_LENGTH)}…[field truncated]`
      : value;
  }
  if (depth >= 6) return "[nested value omitted]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => contextValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, contextValue(item, depth + 1)]),
    );
  }
  return String(value);
}

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
  campaign?: Campaign;
  profile?: Profile;
  strategy?: ProspectingStrategy;
  persona?: BuyerPersona;
  strategyAssignment?: StrategyAssignment;
  caseStudy?: ScriptLibraryItem;
  /** Optional Script library template chosen in Build sequence (style guide - not pasted). */
  selectedTemplate?: Pick<
    ScriptLibraryItem,
    "id" | "title" | "category" | "primaryText" | "secondaryText"
  > | null;
  labels?: CrmLabel[];
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
    lead: contextValue(lead),
    account: contextValue(
      account ?? {
        name: lead.companyName,
        industry: lead.companyIndustry,
        domain: lead.companyDomain,
        companySize: lead.companySize,
        revenueRange: lead.revenueRange,
      },
    ),
    contact: contextValue({
      ...(contact ?? {}),
      name: contactName,
      email: contactEmail,
      title: contactTitle,
    }),
    personalizationProfile,
    deal: contextValue(deal ?? null),
    campaign: contextValue(input.campaign ?? null),
    outreachProfile: contextValue(input.profile ?? null),
    prospectingStrategy: contextValue(input.strategy ?? null),
    buyerPersona: contextValue(input.persona ?? null),
    strategyAssignment: contextValue(input.strategyAssignment ?? null),
    linkedCaseStudyOrScript: contextValue(input.caseStudy ?? null),
    selectedTemplate: contextValue(input.selectedTemplate ?? null),
    labels: contextValue(input.labels ?? []),
    notes: contextValue(notes.slice(0, 30)),
    timeline: contextValue(timeline.slice(0, 40)),
    touchpoints: contextValue(touchpoints.slice(0, 30)),
    followups: contextValue(followups.slice(0, 30)),
    tasks: contextValue(tasks.slice(0, 30)),
    emailThreads: contextValue(input.emailThreads?.slice(0, 20) ?? []),
    followupPlans: contextValue((input.followupPlans ?? []).slice(0, 10)),
    regenerateContext: contextValue(input.regenerateContext ?? null),
  };
  return JSON.stringify(payload);
}
