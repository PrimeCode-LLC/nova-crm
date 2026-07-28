import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { resolveLiveTenantForSession } from "@/lib/auth/resolve-live-tenant";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { OrganizationSettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function OrganizationSettingsPage() {
  const session = await requireSession();

  const live = isAuthDisabled()
    ? { organizationId: session.organizationId, orgRole: session.orgRole, membershipPending: false }
    : await resolveLiveTenantForSession(session);
  const orgId = live.organizationId;
  const role = live.orgRole;
  if (!orgId && !isAuthDisabled()) redirect("/onboarding");

  const org = orgId ? await getOrganizationServer(orgId) : null;

  return (
    <OrganizationSettingsClient
      organization={
        org
          ? {
              id: org.id,
              name: org.name,
              slug: org.slug,
              planId: org.planId,
              seatsUsed: org.seatsUsed ?? 0,
              maxUsers: org.maxUsers ?? null,
              primaryEmail: org.primaryEmail ?? null,
              billingEmail: org.settings.billingEmail ?? "",
              timezone: org.settings.timezone ?? "",
              updatedAt: org.updatedAt,
            }
          : null
      }
      role={role ?? "member"}
    />
  );
}
