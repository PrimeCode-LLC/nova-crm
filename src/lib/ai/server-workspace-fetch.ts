import { isDatabaseConfigured } from "@/lib/db/prisma";
import { listDealsFromPostgres } from "@/lib/db/list-crm-postgres";
import { listLeadsFromPostgres } from "@/lib/db/list-leads-postgres";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { Deal, Followup, Lead, LeadTask, User } from "@/lib/types";

export type ServerWorkspaceBundle = {
  leads: Lead[];
  deals: Deal[];
  followups: Followup[];
  leadTasks: LeadTask[];
  users: User[];
};

/**
 * Tenant workspace snapshot for AI brief / server helpers.
 * CRM entities come from paginated Postgres lists (no arbitrary top-N).
 * Document collections load the full org filter (no silent 2000 cap).
 */
export async function fetchTenantWorkspaceBundleServer(
  organizationId: string,
): Promise<ServerWorkspaceBundle | null> {
  const orgId = organizationId.trim();
  if (!orgId) return null;

  const db = getAdminDb();
  if (!db && !isDatabaseConfigured()) return null;

  const loadOrgCollection = async <T>(
    collection: string,
    map: (id: string, raw: Record<string, unknown>) => T,
  ): Promise<T[]> => {
    if (!db) return [];
    const snap = await db
      .collection(collection)
      .where("organizationId", "==", orgId)
      .get();
    return snap.docs.map((d) => map(d.id, d.data() as Record<string, unknown>));
  };

  const [leads, deals, followups, leadTasks, users] = await Promise.all([
    isDatabaseConfigured()
      ? listLeadsFromPostgres({ organizationId: orgId })
      : loadOrgCollection(COLLECTIONS.leads, (id, raw) => ({ ...raw, id }) as Lead),
    isDatabaseConfigured()
      ? listDealsFromPostgres({ organizationId: orgId })
      : loadOrgCollection(COLLECTIONS.deals, (id, raw) => ({ ...raw, id }) as Deal),
    loadOrgCollection(COLLECTIONS.followups, (id, raw) => ({ ...raw, id }) as Followup),
    loadOrgCollection(COLLECTIONS.leadTasks, (id, raw) => ({ ...raw, id }) as LeadTask),
    loadOrgCollection(COLLECTIONS.users, (id, raw) => ({ ...raw, id }) as User),
  ]);

  return { leads, deals, followups, leadTasks, users };
}
