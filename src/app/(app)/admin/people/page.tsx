import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { resolveLiveTenantForSession } from "@/lib/auth/resolve-live-tenant";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { PeoplePageClient } from "./people-client";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const session = await requireSession();

  const live = isAuthDisabled()
    ? { organizationId: session.organizationId, orgRole: session.orgRole, membershipPending: false }
    : await resolveLiveTenantForSession(session);
  const orgId = live.organizationId;
  const role = live.orgRole;
  if (!orgId && !isAuthDisabled()) redirect("/onboarding");

  const org = orgId ? await getOrganizationServer(orgId) : null;

  return (
    <PeoplePageClient
      currentUid={session.uid}
      organization={
        org
          ? {
              id: org.id,
              name: org.name,
              slug: org.slug,
              status: org.status,
              planId: org.planId,
              seatsUsed: org.seatsUsed ?? 0,
              maxUsers: org.maxUsers ?? null,
              primaryEmail: org.primaryEmail ?? null,
            }
          : null
      }
      role={role ?? "member"}
    />
  );
}
