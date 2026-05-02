import { NextResponse } from "next/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { getVerifiedSession } from "@/lib/auth/server";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { findMembershipForUserServer } from "@/lib/platform/members-server";
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
  const isPlatformAdmin = await isUserPlatformAdmin(session.uid, session.email);
  let membershipPending = false;
  let pendingOrganizationName: string | null = null;
  try {
    const m = await findMembershipForUserServer(session.uid);
    if (m?.status === "pending") {
      membershipPending = true;
      const org = await getOrganizationServer(m.organizationId);
      pendingOrganizationName = org?.name ?? null;
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({
    user: session,
    isPlatformAdmin,
    membershipPending,
    pendingOrganizationName,
  });
}
