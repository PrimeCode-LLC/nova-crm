import type { InstantlyLeadInput } from "./types";
import type { Lead } from "@/lib/types";

export type InstantlyMergeVariable = {
  token: string;
  label: string;
  source: string;
};

/** Merge tags available when pushing Nova leads to Instantly (use in Sequence subject/body). */
export const INSTANTLY_MERGE_VARIABLES: InstantlyMergeVariable[] = [
  { token: "first_name", label: "First name", source: "Contact name (first word)" },
  { token: "last_name", label: "Last name", source: "Contact name (remaining words)" },
  { token: "email", label: "Email", source: "Contact email" },
  { token: "company_name", label: "Company", source: "Company name" },
  { token: "company_domain", label: "Company domain", source: "Company domain" },
  { token: "company_industry", label: "Industry", source: "Company industry" },
  { token: "contact_title", label: "Job title", source: "Contact title" },
  { token: "linkedin", label: "LinkedIn", source: "Contact LinkedIn URL" },
  { token: "trigger_event", label: "Trigger event", source: "Lead trigger event" },
  { token: "ps_line", label: "P.S. line", source: "Personalization line" },
  { token: "pain_points", label: "Pain points", source: "Lead pain points" },
  { token: "business_focus", label: "Business focus", source: "Business focus" },
];

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Map Firestore lead document to Lead snapshot for Instantly push (server-side). */
export function leadSnapshotFromFirestore(id: string, raw: Record<string, unknown>): Lead {
  return {
    id,
    accountId: String(raw.accountId ?? ""),
    contactId: String(raw.contactId ?? ""),
    channel: (raw.channel as Lead["channel"]) ?? "cold_email",
    campaignId: optionalString(raw.campaignId),
    profileId: optionalString(raw.profileId),
    stage: (raw.stage as Lead["stage"]) ?? "new",
    temperature: (raw.temperature as Lead["temperature"]) ?? "cold",
    priority: (raw.priority as Lead["priority"]) ?? "medium",
    ownerId: String(raw.ownerId ?? ""),
    contactName: String(raw.contactName ?? ""),
    contactTitle: optionalString(raw.contactTitle),
    contactEmail: optionalString(raw.contactEmail),
    contactLinkedIn: optionalString(raw.contactLinkedIn),
    companyName: String(raw.companyName ?? ""),
    companyDomain: optionalString(raw.companyDomain),
    companyIndustry: optionalString(raw.companyIndustry),
    triggerEvent: optionalString(raw.triggerEvent),
    painPoints: optionalString(raw.painPoints),
    businessFocus: optionalString(raw.businessFocus),
    psLine: optionalString(raw.psLine),
    doNotContact: Boolean(raw.doNotContact),
    pushToInstantly: raw.pushToInstantly as Lead["pushToInstantly"],
    touches: Number(raw.touches ?? 0),
    intakeKind: raw.intakeKind as Lead["intakeKind"],
  } as Lead;
}

function setCustom(
  out: Record<string, string>,
  key: string,
  value: string | undefined,
): void {
  if (value?.trim()) out[key] = value.trim();
}

export function mapNovaLeadToInstantly(lead: Lead): InstantlyLeadInput | null {
  const email = lead.contactEmail?.trim();
  if (!email) return null;

  const parts = lead.contactName.trim().split(/\s+/);
  const first_name = parts[0] || undefined;
  const last_name = parts.length > 1 ? parts.slice(1).join(" ") : undefined;

  const custom_variables: Record<string, string> = {};
  setCustom(custom_variables, "company_name", lead.companyName);
  setCustom(custom_variables, "company_domain", lead.companyDomain);
  setCustom(custom_variables, "company_industry", lead.companyIndustry);
  setCustom(custom_variables, "contact_title", lead.contactTitle);
  setCustom(custom_variables, "linkedin", lead.contactLinkedIn);
  setCustom(custom_variables, "trigger_event", lead.triggerEvent);
  setCustom(custom_variables, "ps_line", lead.psLine);
  setCustom(custom_variables, "pain_points", lead.painPoints);
  setCustom(custom_variables, "business_focus", lead.businessFocus);

  return {
    email,
    first_name,
    last_name,
    company_name: lead.companyName || undefined,
    custom_variables: Object.keys(custom_variables).length > 0 ? custom_variables : undefined,
  };
}
