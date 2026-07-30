import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { resolveLiveTenantForSession } from "@/lib/auth/resolve-live-tenant";
import { listMembersForDisplayServer } from "@/lib/platform/member-display";
import { AdminLogsClient } from "./admin-logs-client";

export const dynamic = "force-dynamic";

export default async function ActivityLogsPage() {
  const session = await requireSession();

  const live = isAuthDisabled()
    ? { organizationId: session.organizationId, orgRole: session.orgRole, membershipPending: false }
    : await resolveLiveTenantForSession(session);
  const orgId = live.organizationId;
  const role = live.orgRole;
  if (!orgId && !isAuthDisabled()) redirect("/onboarding");

  const members = orgId ? await listMembersForDisplayServer(orgId) : [];

  return <AdminLogsClient orgRole={role ?? "member"} members={members} />;
}
