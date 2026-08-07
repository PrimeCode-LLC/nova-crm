import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Deal, Followup, Lead, LeadTask, User } from "@/lib/types";

export type ServerWorkspaceBundle = {
  leads: Lead[];
  deals: Deal[];
  followups: Followup[];
  leadTasks: LeadTask[];
  users: User[];
};

export async function fetchTenantWorkspaceBundleServer(
  organizationId: string,
): Promise<ServerWorkspaceBundle | null> {
  const db = getAdminDb();
  if (!db) return null;

  const orgFilter = (col: string) =>
    db.collection(col).where("organizationId", "==", organizationId).limit(2000);

  const [leadsSnap, dealsSnap, followupsSnap, tasksSnap, usersSnap] = await Promise.all([
    orgFilter(COLLECTIONS.leads).get(),
    orgFilter(COLLECTIONS.deals).get(),
    orgFilter(COLLECTIONS.followups).get(),
    orgFilter(COLLECTIONS.leadTasks).get(),
    db.collection(COLLECTIONS.users).where("organizationId", "==", organizationId).get(),
  ]);

  const mapLead = (id: string, raw: Record<string, unknown>): Lead =>
    ({ ...raw, id } as Lead);
  const mapDeal = (id: string, raw: Record<string, unknown>): Deal =>
    ({ ...raw, id } as Deal);

  return {
    leads: leadsSnap.docs.map((d) => mapLead(d.id, d.data() as Record<string, unknown>)),
    deals: dealsSnap.docs.map((d) => mapDeal(d.id, d.data() as Record<string, unknown>)),
    followups: followupsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Followup),
    leadTasks: tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as LeadTask),
    users: usersSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as User),
  };
}
