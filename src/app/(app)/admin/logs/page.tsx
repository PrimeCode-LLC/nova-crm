import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { findMembershipForUserServer, listMembersServer } from "@/lib/platform/members-server";
import { ActivityLogsClient } from "./activity-logs-client";

export const dynamic = "force-dynamic";

export default async function ActivityLogsPage() {
  const session = await requireSession();

  let orgId = session.organizationId;
  let role = session.orgRole;

  if (!orgId && !isAuthDisabled()) {
    const m = await findMembershipForUserServer(session.uid);
    if (!m) redirect("/onboarding");
    orgId = m.organizationId;
    role = m.role;
  }

  const members = orgId
    ? (await listMembersServer(orgId)).map((m) => ({
        uid: m.uid,
        label: m.displayName?.trim() || m.email || m.uid,
      }))
    : [];

  return <ActivityLogsClient orgRole={role ?? "member"} members={members} />;
}
