import { NextResponse } from "next/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { getVerifiedSession } from "@/lib/auth/server";
import {
  resolveLiveTenantForSession,
  sessionWithLiveTenant,
} from "@/lib/auth/resolve-live-tenant";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { getOrganizationServer } from "@/lib/platform/organizations-server";

export async function GET() {
  if (isAuthDisabled()) {
    return NextResponse.json({
      user: { uid: "dev", email: "dev@local", name: "Dev user" },
      isPlatformAdmin: true,
      membershipPending: false,
    });
  }
  const session = await getVerifiedSession();
  if (!session) {
    return NextResponse.json({ user: null, isPlatformAdmin: false }, { status: 401 });
  }
  const live = await resolveLiveTenantForSession(session);
  const user = await sessionWithLiveTenant(session);
  const isPlatformAdmin = await isUserPlatformAdmin(session.uid, session.email);
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
  });
}
