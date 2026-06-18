import type { InstantlyLead, InstantlyLeadInput } from "./types";
import type { Lead } from "@/lib/types";

export type { InstantlyMergeVariable } from "./merge-variables";
export { INSTANTLY_MERGE_VARIABLES } from "./merge-variables";

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

export type InstantlyLeadContactFields = {
  email: string;
  contactName: string;
  contactTitle?: string;
  companyName: string;
  companyDomain?: string;
};

/** Map an Instantly campaign lead into Nova contact/lead snapshot fields. */
export function mapInstantlyLeadToContact(remote: InstantlyLead): InstantlyLeadContactFields | null {
  const email = remote.email?.trim().toLowerCase();
  if (!email) return null;

  const first = remote.first_name?.trim() ?? "";
  const last = remote.last_name?.trim() ?? "";
  const fromParts = [first, last].filter(Boolean).join(" ").trim();
  const localPart = email.split("@")[0] ?? "";
  const fromEmail =
    localPart.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Contact";
  const contactName = fromParts || fromEmail;

  const payload = remote.payload && typeof remote.payload === "object" ? remote.payload : {};
  const businessFromPayload =
    typeof payload.business_name === "string"
      ? payload.business_name.trim()
      : typeof payload.company_name === "string"
        ? payload.company_name.trim()
        : "";

  const companyName =
    remote.company_name?.trim() ||
    businessFromPayload ||
    remote.company_domain?.trim() ||
    (email.includes("@") ? email.split("@")[1]! : "Unknown");

  const companyDomain =
    remote.company_domain?.trim() ||
    (email.includes("@") ? email.split("@")[1] : undefined);

  return {
    email,
    contactName,
    contactTitle: remote.job_title?.trim() || undefined,
    companyName,
    companyDomain,
  };
}

export function mapNovaLeadToInstantly(lead: Lead): InstantlyLeadInput | null {
  const email = lead.contactEmail?.trim();
  if (!email) return null;

  const parts = lead.contactName.trim().split(/\s+/);
  const first_name = parts[0] || undefined;
  const last_name = parts.length > 1 ? parts.slice(1).join(" ") : undefined;

  const custom_variables: Record<string, string> = {};
  setCustom(custom_variables, "business_name", lead.companyName);
  setCustom(custom_variables, "company_domain", lead.companyDomain);
  setCustom(custom_variables, "company_industry", lead.companyIndustry);
  setCustom(custom_variables, "contact_title", lead.contactTitle);
  setCustom(custom_variables, "linkedin", lead.contactLinkedIn);
  setCustom(custom_variables, "trigger_event", lead.triggerEvent);
  setCustom(custom_variables, "ps_line", lead.psLine);
  setCustom(custom_variables, "pain_points", lead.painPoints);
  setCustom(custom_variables, "business_focus", lead.businessFocus);
  setCustom(custom_variables, "stage", lead.stage);
  setCustom(custom_variables, "priority", lead.priority);
  setCustom(custom_variables, "channel", lead.channel);
  setCustom(custom_variables, "temperature", lead.temperature);
  if (lead.intakeKind) setCustom(custom_variables, "intake_kind", lead.intakeKind);
  if (lead.estimatedValue != null && !Number.isNaN(lead.estimatedValue)) {
    setCustom(custom_variables, "estimated_value", String(lead.estimatedValue));
  }

  return {
    email,
    first_name,
    last_name,
    company_name: lead.companyName || undefined,
    custom_variables: Object.keys(custom_variables).length > 0 ? custom_variables : undefined,
  };
}
