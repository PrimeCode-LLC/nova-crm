import { parseBootstrapPlatformAdminEmails } from "@/lib/platform/check-platform-admin";
import { listOrganizationsServer } from "@/lib/platform/organizations-server";
import { listPlatformAdminsServer } from "@/lib/platform/platform-admins-server";
import type { OrganizationStatus, PlatformStats, SaaSPlanId } from "@/lib/types";

const TRIAL_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

function emptyStatusCounts(): Record<OrganizationStatus, number> {
  return { trial: 0, active: 0, suspended: 0, archived: 0 };
}

function emptyPlanCounts(): Record<SaaSPlanId, number> {
  return { free: 0, pro: 0, enterprise: 0 };
}

export async function getPlatformStatsServer(): Promise<PlatformStats> {
  const [orgs, admins] = await Promise.all([
    listOrganizationsServer(),
    listPlatformAdminsServer(),
  ]);
  const bootstrapEmails = parseBootstrapPlatformAdminEmails();
  const now = Date.now();

  const byStatus = emptyStatusCounts();
  const byPlan = emptyPlanCounts();
  let unnamedCount = 0;
  let trialsExpiringSoon = 0;
  let totalSeatsUsed = 0;

  for (const org of orgs) {
    const status = org.status in byStatus ? org.status : "trial";
    byStatus[status] += 1;
    if (org.planId in byPlan) byPlan[org.planId] += 1;
    if (!org.name?.trim()) unnamedCount += 1;
    totalSeatsUsed += org.seatsUsed ?? 0;
    if (
      org.status === "trial" &&
      org.trialEndsAt &&
      new Date(org.trialEndsAt).getTime() - now <= TRIAL_WARNING_MS &&
      new Date(org.trialEndsAt).getTime() > now
    ) {
      trialsExpiringSoon += 1;
    }
  }

  const recentOrgs = orgs.slice(0, 8).map((o) => ({
    id: o.id,
    name: o.name?.trim() || "Unnamed workspace",
    slug: o.slug,
    status: o.status,
    updatedAt: o.updatedAt,
  }));

  return {
    totalOrgs: orgs.length,
    byStatus,
    byPlan,
    unnamedCount,
    trialsExpiringSoon,
    totalSeatsUsed,
    adminCount: admins.filter((a) => a.active).length,
    bootstrapAdminCount: bootstrapEmails.size,
    recentOrgs,
  };
}
