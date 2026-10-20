/**
 * Server-side record scope for CRM detail reads and writes (QA 1.2).
 *
 * Uses the same visibility rules the list APIs apply in SQL, so a member can
 * only read or change records they could already see in their lists:
 * - leads: owner, owner's managers, shared owners, prospect assignees
 * - accounts / contacts: owner or owner's managers, or a visible lead linked to them
 * - deals: owner or owner's managers, or a visible linked lead
 * Org owners/admins, CRM directors and super admins see the whole tenant.
 */

import {
  getLeadFromPostgres,
  ownedMatchesMemberScope,
} from "@/lib/db/list-crm-postgres";
import { leadMatchesMemberScope, memberLeadScopeWhere } from "@/lib/db/list-leads-postgres";
import { resolveCrmListNarrowForSession } from "@/lib/db/crm-list-scope";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import type { Account, Contact, Deal, Lead, OrgMemberRole } from "@/lib/types";

export type CrmViewer = {
  organizationId: string;
  uid: string;
  orgRole: OrgMemberRole;
};

/** True when the viewer is limited to their own slice of CRM records. */
export async function isCrmViewerNarrowed(viewer: CrmViewer): Promise<boolean> {
  return resolveCrmListNarrowForSession(viewer.orgRole, null, viewer.uid);
}

async function hasVisibleLinkedLead(
  viewer: CrmViewer,
  link: { accountId?: string; contactId?: string },
): Promise<boolean> {
  const where = link.accountId
    ? { accountId: link.accountId }
    : link.contactId
      ? { contactId: link.contactId }
      : null;
  if (!where) return false;
  const row = await withOrganizationScope(viewer.organizationId, (tx) =>
    tx.lead.findFirst({
      where: {
        organizationId: viewer.organizationId,
        ...where,
        ...memberLeadScopeWhere(viewer.uid),
      },
      select: { id: true },
    }),
  );
  return Boolean(row);
}

export function leadVisibleToMember(lead: Lead, uid: string): boolean {
  return leadMatchesMemberScope(lead, uid);
}

export async function accountVisibleToMember(viewer: CrmViewer, account: Account): Promise<boolean> {
  if (ownedMatchesMemberScope(account, viewer.uid)) return true;
  return hasVisibleLinkedLead(viewer, { accountId: account.id });
}

export async function contactVisibleToMember(viewer: CrmViewer, contact: Contact): Promise<boolean> {
  if (ownedMatchesMemberScope(contact, viewer.uid)) return true;
  return hasVisibleLinkedLead(viewer, { contactId: contact.id });
}

/** Detail-read gate: whole tenant for oversight roles, own slice for members. */
export async function viewerCanSeeCrmRecord(
  viewer: CrmViewer,
  record:
    | { entity: "lead"; value: Lead }
    | { entity: "account"; value: Account }
    | { entity: "contact"; value: Contact }
    | { entity: "deal"; value: Deal },
): Promise<boolean> {
  if (!(await isCrmViewerNarrowed(viewer))) return true;
  switch (record.entity) {
    case "lead":
      return leadVisibleToMember(record.value, viewer.uid);
    case "account":
      return accountVisibleToMember(viewer, record.value);
    case "contact":
      return contactVisibleToMember(viewer, record.value);
    case "deal":
      return dealVisibleToMember(viewer, record.value);
  }
}

export async function dealVisibleToMember(viewer: CrmViewer, deal: Deal): Promise<boolean> {
  if (ownedMatchesMemberScope(deal, viewer.uid)) return true;
  if (!deal.leadId?.trim()) return false;
  const lead = await getLeadFromPostgres(viewer.organizationId, deal.leadId);
  return Boolean(lead && leadMatchesMemberScope(lead, viewer.uid));
}
