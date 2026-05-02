import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { findMembershipForUserServer } from "@/lib/platform/members-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { TeamPageClient } from "./team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await requireSession();

  let orgId = session.organizationId;
  let role = session.orgRole;

  if (!orgId && !isAuthDisabled()) {
    const m = await findMembershipForUserServer(session.uid);
    if (!m) redirect("/onboarding");
    orgId = m.organizationId;
    role = m.role;
  }

  const org = orgId ? await getOrganizationServer(orgId) : null;

  return (
    <TeamPageClient
      currentUid={session.uid}
      organization={org ? {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        planId: org.planId,
        seatsUsed: org.seatsUsed ?? 0,
        maxUsers: org.maxUsers ?? null,
        primaryEmail: org.primaryEmail ?? null,
      } : null}
      role={role ?? "member"}
    />
  );
}
