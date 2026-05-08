import type { Account, Contact, Lead } from "./types";

/** Keeps denormalized `Lead` snapshot fields in sync after account/contact edits. */
export function leadSnapshotPatchFromAccountContact(
  accountPatch: Partial<Account>,
  contactPatch: Partial<Contact>,
): Partial<Lead> {
  const out: Partial<Lead> = {};

  if (accountPatch.name !== undefined) out.companyName = accountPatch.name;
  if (accountPatch.domain !== undefined) out.companyDomain = accountPatch.domain;
  if (accountPatch.industry !== undefined) out.companyIndustry = accountPatch.industry;
  if (accountPatch.size !== undefined) out.companySize = accountPatch.size;
  if (accountPatch.revenueRange !== undefined) out.revenueRange = accountPatch.revenueRange;

  const fn = contactPatch.firstName;
  const ln = contactPatch.lastName;
  if (fn !== undefined || ln !== undefined) {
    const f = (fn ?? "").trim();
    const l = (ln ?? "").trim();
    if (f || l) {
      out.contactName = f && l && f !== l ? `${f} ${l}`.trim() : f || l;
    }
  }
  if (contactPatch.title !== undefined) out.contactTitle = contactPatch.title;
  if (contactPatch.email !== undefined) out.contactEmail = contactPatch.email;
  if (contactPatch.linkedin !== undefined) out.contactLinkedIn = contactPatch.linkedin;

  return out;
}
