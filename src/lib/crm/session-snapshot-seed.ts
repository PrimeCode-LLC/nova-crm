import { peekCrmEntity } from "@/lib/crm/entity-cache";
import { isWorkspaceCrmSnapshotOff } from "@/lib/dashboard-kpi-v2-flags";
import type { Account, Contact, Lead } from "@/lib/types";
import type { WorkspaceSessionV2 } from "@/lib/workspace-session";
import type { WorkspaceSnapshot } from "@/lib/workspace-dataset-core";

/**
 * When the live snapshot is empty, session patches still need a base row.
 * Seed only rows already in the entity cache. Flag off returns the snapshot unchanged.
 */
export function withCachedSessionTargets(
  base: WorkspaceSnapshot,
  session: WorkspaceSessionV2,
): WorkspaceSnapshot {
  if (!isWorkspaceCrmSnapshotOff()) return base;
  const leadIds = new Set(base.leads.map((lead) => lead.id));
  const extraLeads: Lead[] = [];
  for (const id of new Set([
    ...Object.keys(session.leadPatches ?? {}),
    ...Object.keys(session.leadActivity ?? {}),
  ])) {
    if (leadIds.has(id)) continue;
    const cached = peekCrmEntity("leads", id);
    if (cached) extraLeads.push(cached);
  }
  const accountIds = new Set(base.accounts.map((account) => account.id));
  const extraAccounts: Account[] = [];
  for (const id of Object.keys(session.accountPatches ?? {})) {
    if (accountIds.has(id)) continue;
    const cached = peekCrmEntity("accounts", id);
    if (cached) extraAccounts.push(cached);
  }
  const contactIds = new Set(base.contacts.map((contact) => contact.id));
  const extraContacts: Contact[] = [];
  for (const id of Object.keys(session.contactPatches ?? {})) {
    if (contactIds.has(id)) continue;
    const cached = peekCrmEntity("contacts", id);
    if (cached) extraContacts.push(cached);
  }
  if (!extraLeads.length && !extraAccounts.length && !extraContacts.length) return base;
  return {
    ...base,
    leads: [...base.leads, ...extraLeads],
    accounts: [...base.accounts, ...extraAccounts],
    contacts: [...base.contacts, ...extraContacts],
  };
}
