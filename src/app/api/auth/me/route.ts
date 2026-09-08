import { NextResponse } from "next/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { getVerifiedSession } from "@/lib/auth/server";
import { resolveLiveTenantForSession } from "@/lib/auth/resolve-live-tenant";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { isBackupOnlyModeEnabled } from "@/lib/platform/platform-settings-server";

export async function GET() {
  if (isAuthDisabled()) {
    return NextResponse.json({
      user: { uid: "dev", email: "dev@local", name: "Dev user" },
      isPlatformAdmin: true,
      membershipPending: false,
      backupOnlyMode: await isBackupOnlyModeEnabled(),
    });
  }
  const session = await getVerifiedSession();
  if (!session) {
    return NextResponse.json({ user: null, isPlatformAdmin: false }, { status: 401 });
  }

  const [live, isPlatformAdmin, backupOnlyMode] = await Promise.all([
    resolveLiveTenantForSession(session),
    isUserPlatformAdmin(session.uid, session.email),
    isBackupOnlyModeEnabled(),
  ]);

  const user = {
    ...session,
    organizationId: live.organizationId,
    orgRole: live.orgRole,
  };

  let membershipPending = live.membershipPending;
  let pendingOrganizationName: string | null = null;
  try {
    if (membershipPending && live.organizationId) {
      const org = await getOrganizationServer(live.organizationId);
      pendingOrganizationName = org?.name ?? null;
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({
    user,
    isPlatformAdmin,
    membershipPending,
    pendingOrganizationName,
    backupOnlyMode,
  });
}
